/**
 * src/services/analytics.js — MongoDB Aggregation Pipelines
 * Implements:
 * 1. compareSimulations(simIdA, simIdB) — uses $setDifference and $setIntersection
 * 2. blastRankings(projectId) — top 10 simulations by blast radius score
 * 3. fragileComponents(projectId) — components most frequently impacted with worst status
 * 4. hotspots(versionId) — most depended-upon components in the graph
 */
const { getDb } = require('../db/index');

/**
 * Compare two simulations using MongoDB aggregation.
 * Uses $setDifference and $setIntersection on affected component IDs.
 *
 * @param {string} simIdA - First simulation ID
 * @param {string} simIdB - Second simulation ID
 * @returns {Object|null} Comparison result or null if either ID not found
 */
async function compareSimulations(simIdA, simIdB) {
  const db = getDb();

  // Aggregation pipeline on impact_reports
  const pipeline = [
    // Stage 1: Match only the two requested impact reports
    {
      $match: {
        _id: { $in: [simIdA, simIdB] }
      }
    },
    // Stage 2: Join with simulations to get score, label, and change details
    {
      $lookup: {
        from: 'simulations',
        localField: '_id',
        foreignField: '_id',
        as: 'sim'
      }
    },
    // Stage 3: Unwind joined simulation
    {
      $unwind: {
        path: '$sim',
        preserveNullAndEmptyArrays: true
      }
    },
    // Stage 4: Group all matching documents into a single array for set comparison
    {
      $group: {
        _id: null,
        docs: { $push: '$$ROOT' }
      }
    },
    // Stage 5: Separate docA and docB from the docs array
    {
      $project: {
        docA: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$docs',
                as: 'd',
                cond: { $eq: ['$$d._id', simIdA] }
              }
            },
            0
          ]
        },
        docB: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$docs',
                as: 'd',
                cond: { $eq: ['$$d._id', simIdB] }
              }
            },
            0
          ]
        }
      }
    },
    // Stage 6: Calculate set differences and intersection on affected componentIds
    {
      $project: {
        docA: 1,
        docB: 1,
        // $setDifference: components in A that are NOT in B
        onlyInAIds: {
          $setDifference: [
            { $ifNull: ['$docA.affected.componentId', []] },
            { $ifNull: ['$docB.affected.componentId', []] }
          ]
        },
        // $setDifference: components in B that are NOT in A
        onlyInBIds: {
          $setDifference: [
            { $ifNull: ['$docB.affected.componentId', []] },
            { $ifNull: ['$docA.affected.componentId', []] }
          ]
        },
        // $setIntersection: components affected in BOTH A and B
        inBothIds: {
          $setIntersection: [
            { $ifNull: ['$docA.affected.componentId', []] },
            { $ifNull: ['$docB.affected.componentId', []] }
          ]
        }
      }
    }
  ];

  const results = await db.collection('impact_reports').aggregate(pipeline).toArray();

  if (!results.length || !results[0].docA || !results[0].docB) {
    return null; // One or both simulations not found
  }

  const { docA, docB, onlyInAIds, onlyInBIds, inBothIds } = results[0];

  const affectedMapA = new Map((docA.affected || []).map(a => [a.componentId, a]));
  const affectedMapB = new Map((docB.affected || []).map(b => [b.componentId, b]));

  const onlyInA = (onlyInAIds || []).map(id => affectedMapA.get(id)).filter(Boolean);
  const onlyInB = (onlyInBIds || []).map(id => affectedMapB.get(id)).filter(Boolean);

  const inBoth = (inBothIds || []).map(id => {
    const itemA = affectedMapA.get(id);
    const itemB = affectedMapB.get(id);
    return {
      componentId: id,
      name: itemA?.name || itemB?.name,
      type: itemA?.type || itemB?.type,
      statusA: itemA?.status,
      statusB: itemB?.status,
      criticality: itemA?.criticality || itemB?.criticality,
      reasonA: itemA?.reason,
      reasonB: itemB?.reason
    };
  });

  const scoreA = docA.sim?.score ?? 0;
  const scoreB = docB.sim?.score ?? 0;

  return {
    simulationA: {
      id: docA._id,
      change: docA.sim?.change,
      score: scoreA,
      label: docA.sim?.label,
      counts: docA.sim?.counts
    },
    simulationB: {
      id: docB._id,
      change: docB.sim?.change,
      score: scoreB,
      label: docB.sim?.label,
      counts: docB.sim?.counts
    },
    scoreDifference: scoreA - scoreB,
    onlyInA,
    onlyInB,
    inBoth,
    counts: {
      onlyInA: onlyInA.length,
      onlyInB: onlyInB.length,
      inBoth: inBoth.length
    }
  };
}

/**
 * Top 10 simulations by blast radius score for a given project.
 *
 * @param {string} projectId
 * @returns {Promise<Array>}
 */
async function blastRankings(projectId) {
  const db = getDb();

  return await db.collection('simulations').aggregate([
    // Stage 1: Match simulations for the specified project
    { $match: { projectId } },
    // Stage 2: Sort descending by score
    { $sort: { score: -1, createdAt: -1 } },
    // Stage 3: Top 10
    { $limit: 10 },
    // Stage 4: Clean projection
    {
      $project: {
        _id: 1,
        simulationId: '$_id',
        versionId: 1,
        change: 1,
        score: 1,
        label: 1,
        counts: 1,
        createdAt: 1
      }
    }
  ]).toArray();
}

/**
 * Fragile components: components that are broken/at-risk most frequently
 * across all simulations for a project.
 *
 * @param {string} projectId
 * @returns {Promise<Array>}
 */
async function fragileComponents(projectId) {
  const db = getDb();

  return await db.collection('impact_reports').aggregate([
    // Stage 1: Filter impact reports for this project
    { $match: { projectId } },
    // Stage 2: Flatten affected components array
    { $unwind: '$affected' },
    // Stage 3: Map string statuses to numerical severity for ranking
    {
      $addFields: {
        severityRank: {
          $switch: {
            branches: [
              { case: { $eq: ['$affected.status', 'BROKEN'] }, then: 3 },
              { case: { $eq: ['$affected.status', 'AT_RISK'] }, then: 2 },
              { case: { $eq: ['$affected.status', 'UNCERTAIN'] }, then: 1 }
            ],
            default: 0
          }
        }
      }
    },
    // Stage 4: Group by componentId, count appearances and find max severity
    {
      $group: {
        _id: '$affected.componentId',
        componentId: { $first: '$affected.componentId' },
        name: { $first: '$affected.name' },
        type: { $first: '$affected.type' },
        criticality: { $first: '$affected.criticality' },
        impactCount: { $sum: 1 },
        maxSeverityRank: { $max: '$severityRank' }
      }
    },
    // Stage 5: Map numeric rank back to readable worst status
    {
      $addFields: {
        worstStatus: {
          $switch: {
            branches: [
              { case: { $eq: ['$maxSeverityRank', 3] }, then: 'BROKEN' },
              { case: { $eq: ['$maxSeverityRank', 2] }, then: 'AT_RISK' },
              { case: { $eq: ['$maxSeverityRank', 1] }, then: 'UNCERTAIN' }
            ],
            default: 'SAFE'
          }
        }
      }
    },
    // Stage 6: Sort by impact frequency descending, then severity
    { $sort: { impactCount: -1, maxSeverityRank: -1 } },
    // Stage 7: Limit top 10
    { $limit: 10 }
  ]).toArray();
}

/**
 * Hotspots: the most depended-on components in a graph version
 * (i.e. components with the most incoming edges / consumers).
 *
 * @param {string} versionId
 * @returns {Promise<Array>}
 */
async function hotspots(versionId) {
  const db = getDb();

  return await db.collection('dependency_edges').aggregate([
    // Stage 1: Match edges for this graph version
    { $match: { versionId } },
    // Stage 2: Group by the provider component ('to') and count incoming edges
    {
      $group: {
        _id: '$to',
        componentId: { $first: '$to' },
        dependentsCount: { $sum: 1 },
        consumerIds: { $push: '$from' }
      }
    },
    // Stage 3: Sort by dependents count descending
    { $sort: { dependentsCount: -1 } },
    // Stage 4: Limit top 10
    { $limit: 10 },
    // Stage 5: Lookup component details from components collection
    {
      $lookup: {
        from: 'components',
        let: { compId: '$componentId', verId: versionId },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$componentId', '$$compId'] },
                  { $eq: ['$versionId', '$$verId'] }
                ]
              }
            }
          }
        ],
        as: 'comp'
      }
    },
    // Stage 6: Unwind component details
    {
      $unwind: {
        path: '$comp',
        preserveNullAndEmptyArrays: true
      }
    },
    // Stage 7: Clean projection
    {
      $project: {
        _id: 0,
        componentId: 1,
        name: { $ifNull: ['$comp.name', '$componentId'] },
        type: { $ifNull: ['$comp.type', 'unknown'] },
        criticality: { $ifNull: ['$comp.criticality', 3] },
        dependentsCount: 1,
        consumerIds: 1
      }
    }
  ]).toArray();
}

module.exports = {
  compareSimulations,
  blastRankings,
  fragileComponents,
  hotspots
};
