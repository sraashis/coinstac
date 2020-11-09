const Boom = require('boom');
const GraphQLJSON = require('graphql-type-json');
const Promise = require('bluebird');
const axios = require('axios');
const { get } = require('lodash');
const Issue = require('github-api/dist/components/Issue');
const { PubSub, withFilter } = require('graphql-subscriptions');
const { ObjectID } = require('mongodb');
const helperFunctions = require('../auth-helpers');
const initSubscriptions = require('./subscriptions');
const database = require('../database');
const { transformToClient } = require('../utils');

const {
  eventEmitter,
  COMPUTATION_CHANGED,
  COMPUTATION_DELETED,
  CONSORTIUM_CHANGED,
  CONSORTIUM_DELETED,
  PIPELINE_CHANGED,
  PIPELINE_DELETED,
  RUN_CHANGED,
  THREAD_CHANGED,
  USER_CHANGED,
} = require('./events');

const AVAILABLE_ROLE_TYPES = ['data', 'app'];
const AVAILABLE_USER_APP_ROLES = ['admin', 'author'];

async function fetchOnePipeline(id) {
  const db = database.getDbInstance();

  const pipelineSteps = await db.collection('pipelines').aggregate([
    { $match: { _id: id } },
    { $unwind: '$steps' },
    {
      $lookup: {
        from: 'computations',
        localField: 'steps.computations',
        foreignField: '_id',
        as: 'steps.computations',
      },
    },
  ]);

  const hasSteps = await pipelineSteps.hasNext();
  if (!hasSteps) {
    return db.collection('pipelines').findOne({ _id: id });
  }

  let pipe = null;
  do {
    const currentStep = await pipelineSteps.next(); // eslint-disable-line no-await-in-loop

    if (!pipe) {
      pipe = {
        ...currentStep,
        steps: [],
      };
    }

    currentStep.steps.computations = transformToClient(currentStep.steps.computations);

    pipe.steps.push(currentStep.steps);
  } while (await pipelineSteps.hasNext()); // eslint-disable-line no-await-in-loop

  return pipe;
}

/**
 * Helper function for add permissions to an user
 * @param {object} args - Update object
 * @param {string} args.userId - Id of the user which will have permissions changed
 * @param {string} args.role - Role of the user
 * @param {string} args.doc - Id of the document for which the user will gain access
 * @param {string} args.table - Table of the document for which the user will gain access
 */
async function addUserPermissions(args) {
  const db = database.getDbInstance();

  const { role, doc, table } = args;

  const updateObj = {
    $addToSet: {
      [`permissions.${table}.${doc}`]: role,
    },
  };

  if (table === 'consortia') {
    let { userName } = args;

    if (!userName) {
      const user = await helperFunctions.getUserDetailsByID(args.userId);
      userName = user.username;
    }

    updateObj.$set = {
      [`consortiaStatuses.${doc}`]: 'none',
    };

    const consortiaUpdateResult = await db.collection('consortia').findOneAndUpdate({ _id: doc }, {
      $set: {
        [`${role}s.${args.userId}`]: userName,
      },
    }, { returnOriginal: false });

    eventEmitter.emit(CONSORTIUM_CHANGED, consortiaUpdateResult.value);
  }

  const userUpdateResult = await db.collection('users').findOneAndUpdate({ _id: args.userId }, updateObj, { returnOriginal: false });

  eventEmitter.emit(USER_CHANGED, userUpdateResult.value);
}

async function removeUserPermissions(args) {
  const db = database.getDbInstance();

  const user = await db.collection('users').findOne({ _id: args.userId }, {
    projection: { permissions: 1 },
  });

  const { permissions } = user;
  const index = permissions[args.table][args.doc].findIndex(p => p === args.role);
  permissions[args.table][args.doc].splice(index, 1);

  let userUpdateResult;

  if (permissions[args.table][args.doc].length === 0) {
    const updateObj = {
      $unset: {
        [`permissions.${args.table}.${args.doc}`]: '',
      },
    };

    if (args.table === 'consortia') {
      updateObj.$unset[`consortiaStatuses.${args.doc}`] = '';
    }

    userUpdateResult = await db.collection('users').findOneAndUpdate({ _id: args.userId }, updateObj, { returnOriginal: false });
  } else {
    userUpdateResult = await db.collection('users').findOneAndUpdate({ _id: args.userId }, {
      $pull: { [`permissions.${args.table}.${args.doc}`]: args.role },
    }, {
      returnOriginal: false,
    });
  }

  eventEmitter.emit(USER_CHANGED, userUpdateResult.value);

  if (args.table === 'consortia') {
    const updateObj = {
      $unset: {
        [`${args.role}s.${args.userId}`]: userUpdateResult.value.username,
      },
    };
    if (permissions[args.table][args.doc].length === 0) {
      updateObj.$pull = Object.assign(updateObj.$pull || {}, { mappedForRun: args.userId });
    }

    const consortiaUpdateResult = await db.collection('consortia').findOneAndUpdate({ _id: args.doc }, updateObj, { returnOriginal: false });
    eventEmitter.emit(CONSORTIUM_CHANGED, consortiaUpdateResult.value);
  }
}

async function changeUserAppRole(args, addOrRemove) {
  const db = database.getDbInstance();
  const { userId, role } = args;

  const userUpdateResult = await db.collection('users').findOneAndUpdate({ _id: ObjectID(userId) }, {
    $set: {
      [`permissions.roles.${role}`]: addOrRemove === 'add',
    },
  }, {
    returnOriginal: false,
  });

  eventEmitter.emit(USER_CHANGED, userUpdateResult.value);
}

async function filterComputationsByMetaId(db, metaId) {
  const results = await db.collection('computations').find({ 'meta.id': metaId }).toArray();

  return transformToClient(results);
}

function isAdmin(permissions) {
  return get(permissions, 'roles.admin', false);
}

function isAuthor(permissions) {
  return get(permissions, 'roles.author', false);
}

function isAllowedForComputationChange(permissions) {
  return isAdmin(permissions) || isAuthor(permissions);
}

const pubsub = new PubSub();

initSubscriptions(pubsub);

/* eslint-disable */
const resolvers = {
  JSON: GraphQLJSON,
  Query: {
    /**
     * Returns all results.
     * @return {array} All results
     */
    fetchAllResults: async () => {
      const db = database.getDbInstance();

      const results = await db.collection('runs').find().toArray();
      return transformToClient(results);
    },
    /**
     * Returns single pipeline
     * @param {object} args
     * @param {string} args.resultId  Requested pipeline ID
     * @return {object} Requested pipeline if id present, null otherwise
     */
    fetchResult: async (_, args) => {
      if (!args.resultId) {
        return null;
      }

      const db = database.getDbInstance();

      const result = await db.collection('runs').findOne({ _id: ObjectID(args.resultId) });
      return transformToClient(result);
    },
    /**
     * Fetches all public consortia and private consortia for which the current user has access
     * @return {array} All consortia to which the current user access
     */
    fetchAllConsortia: async ({ auth: { credentials } }) => {
      const db = database.getDbInstance();

      const consortia = await db.collection('consortia').find({
        $or: [
          { isPrivate: false },
          { members: credentials.username }
        ]
      }).toArray();

      return transformToClient(consortia);
    },
    /**
     * Returns single consortium.
     * @param {object} args
     * @param {string} args.consortiumId Requested consortium ID
     * @return {object} Requested consortium if id present, null otherwise
     */
    fetchConsortium: async (_, args) => {
      if (!args.consortiumId) {
        return null;
      }

      const db = database.getDbInstance();

      const consortium = await db.collection('consortia').findOne({ _id: ObjectID(args.consortiumId) });
      return transformToClient(consortium);
    },
    /**
     * Returns all computations.
     * @return {array} All computations
     */
    fetchAllComputations: async () => {
      const db = database.getDbInstance();

      const computations = await db.collection('computations').find().toArray();
      return transformToClient(computations);
    },
    /**
     * Returns metadata for specific computation name
     * @param {object} args
     * @param {array} args.computationIds Requested computation ids
     * @return {array} List of computation objects
     */
    fetchComputation: async (_, { computationIds }) => {
      if (!Array.isArray(computationIds) || computationIds.length === 0) {
        return null;
      }

      const db = database.getDbInstance();

      const computations = await db.collection('computations').find({
        _id: { $in: computationIds.map(id => ObjectID(id)) }
      }).toArray();

      return transformToClient(computations);
    },
    /**
     * Returns all pipelines.
     * @return {array} List of all pipelines
     */
    fetchAllPipelines: async () => {
      const db = database.getDbInstance();

      const pipelineSteps = await db.collection('pipelines').aggregate([
        { $unwind: '$steps' },
        {
          $lookup: {
            from: 'computations',
            localField: 'steps.computations',
            foreignField: '_id',
            as: 'steps.computations',
          },
        },
      ]);

      const pipelines = {};
      while (await pipelineSteps.hasNext()) {
        const currentStep = await pipelineSteps.next();


        if (!(currentStep._id in pipelines)) {
          pipelines[currentStep._id] = {
            ...currentStep,
            steps: [],
          };
        }

        currentStep.steps.computations = transformToClient(currentStep.steps.computations);

        pipelines[currentStep._id].steps.push(currentStep.steps);
      }

      const steplessPipelines = await db.collection('pipelines').find({
        steps: { $size: 0 }
      }).toArray();

      steplessPipelines.forEach(p => pipelines[p._id] = p);

      return transformToClient(Object.values(pipelines));
    },
    /**
     * Returns single pipeline
     * @param {object} args
     * @param {string} args.pipelineId  Requested pipeline ID
     * @return {object} Requested pipeline if id present, null otherwise
     */
    fetchPipeline: async (_, args) => {
      if (!args.pipelineId) {
        return null;
      }

      const pipeline = await fetchOnePipeline(ObjectID(args.pipelineId));
      return transformToClient(pipeline);
    },
    /**
     * Returns single user.
     * @param {object} args
     * @param {string} args.userId Requested user ID, restricted to authenticated user for time being
     * @return {object} Requested user if id present, null otherwise
     */
    fetchUser: ({ auth: { credentials } }, args) => {
      return helperFunctions.getUserDetailsByID(args.userId);
    },
    fetchAllUsers: async () => {
      const db = database.getDbInstance();

      const users = await db.collection('users').find().toArray();
      return transformToClient(users);
    },
    fetchAllUserRuns: async ({ auth: { credentials } }, args) => {
      const db = database.getDbInstance();

      const runs = await db.collection('runs').find({
        $or: [
          { clients: credentials.id },
          { sharedUsers: credentials.id }
        ]
      }).toArray();

      return transformToClient(runs);
    },
    fetchAllThreads: async ({ auth: { credentials } }) => {
      const db = database.getDbInstance();

      const threads = await db.collection('threads').find({
        [`users.${credentials.id}`]: { $exists: true }
      }).toArray();

      return transformToClient(threads);
    },
    validateComputation: (_, args) => {
      return new Promise();
    },
  },
  Mutation: {
    /**
     * Add computation to database
     * @param {object} args
     * @param {object} args.computationSchema Computation object to add/update
     * @return {object} New computation object
     */
    addComputation: async ({ auth: { credentials } }, args) => {
      const { permissions } = credentials;
      const { computationSchema } = args;

      if (!isAllowedForComputationChange(permissions)) {
        return Boom.forbidden('Action not permitted');
      }

      const db = database.getDbInstance();

      const filteredComputations = await filterComputationsByMetaId(db, computationSchema.meta.id);

      if (filteredComputations.length === 0) {
        const result = await db.collection('computations').insertOne({
          ...computationSchema,
          submittedBy: credentials.id,
        });

        const computation = result.ops[0];

        eventEmitter.emit(COMPUTATION_CHANGED, computation);

        return transformToClient(computation);
      }

      if (filteredComputations.length === 1) {
        const computation = filteredComputations[0];

        if (computation.submittedBy !== credentials.id && !isAdmin(credentials.permissions)) {
          return Boom.forbidden('Incorrect permissions to update computation');
        }

        const updatedComputationResult = await db.collection('computations').findOneAndUpdate({
          _id: ObjectID(computation.id)
        }, {
          $set: computationSchema,
        }, {
          returnOriginal: false,
        });

        eventEmitter.emit(COMPUTATION_CHANGED, updatedComputationResult.value);

        return transformToClient(updatedComputationResult.value);
      }

      if (filteredComputations.length > 1) {
        return Boom.forbidden('Computation with same meta id already exists.');
      }
    },
    /**
     * Add new user role to user perms, currently consortia perms only
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.doc Id of the document to add role to
     * @param {string} args.role Role to add to perms
     * @param {string} args.userId Id of the user to be added
     * @param {string} args.roleType Type of role to add
     * @return {object} Updated user object
     */
    addUserRole: async ({ auth: { credentials } }, args) => {
      const { permissions } = credentials;

      if (credentials.id === args.userId) {
        return Boom.forbidden('You are not allowed to change your own permission');
      }

      if (AVAILABLE_ROLE_TYPES.indexOf(args.roleType) === -1) {
        return Boom.forbidden('Invalid role type');
      }

      if (args.roleType === 'data') {
        const documentPermissions = permissions[args.table][args.doc];
        if (!documentPermissions || !documentPermissions.includes('owner')) {
          return Boom.forbidden('Action not permitted');
        }

        await addUserPermissions({ doc: ObjectID(args.doc), role: args.role, userId: ObjectID(args.userId), table: args.table });
      }

      if (args.roleType === 'app') {
        if (!isAdmin(permissions) || (AVAILABLE_USER_APP_ROLES.indexOf(args.role) === -1)) {
          return Boom.forbidden('Action not permitted');
        }

        await changeUserAppRole(args, 'add');
      }

      return helperFunctions.getUserDetailsByID(args.userId);
    },
    /**
     * Add run to database
     * @param {String} consortiumId Run object to add/update
     * @return {object} New/updated run object
     */
    createRun: async ({ auth }, { consortiumId }) => {
      if (!auth || !auth.credentials) {
        // No authorized user, reject
        return Boom.unauthorized('User not authenticated');
      }

      const db = database.getDbInstance();

      const consortium = await db.collection('consortia').findOne({ _id: ObjectID(consortiumId) });

      if (!consortium) {
        return Boom.notFound('Consortium with provided id not found');
      }

      const pipeline = await fetchOnePipeline(consortium.activePipelineId);

      if (!pipeline) {
        return Boom.notFound('Active pipeline not found on this consortium');
      }

      try {
        const clientArray = Object.keys(consortium.members);
        const isPipelineDecentralized = pipeline.steps.findIndex(step => step.controller.type === 'decentralized') > -1;
        const result = await db.collection('runs').insertOne({
            clients: clientArray,
            members: consortium.members,
            consortiumId,
            pipelineSnapshot: pipeline,
            startDate: Date.now(),
            type: isPipelineDecentralized ? 'decentralized' : 'local',
        });

        const run = transformToClient(result.ops[0]);

        await axios.post(
          `http://${process.env.PIPELINE_SERVER_HOSTNAME}:${process.env.PIPELINE_SERVER_PORT}/startPipeline`, { run }
        );

        eventEmitter.emit(RUN_CHANGED, run);

        return run;
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          return Boom.serverUnavailable('Pipeline server unavailable');
        }

        return Boom.notAcceptable(error);
      }
    },
    /**
     * Deletes consortium
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.consortiumId Consortium id to delete
     * @return {object} Deleted consortium
     */
    deleteConsortiumById: async ({ auth: { credentials: { permissions } } }, args) => {
      if (!permissions.consortia[args.consortiumId] || !permissions.consortia[args.consortiumId].includes('owner')) {
        return Boom.forbidden('Action not permitted');
      }

      const db = database.getDbInstance();

      const deleteConsortiumResult = await db.collection('consortia').findOneAndDelete({ _id: ObjectID(args.consortiumId) });

      eventEmitter.emit(CONSORTIUM_DELETED, deleteConsortiumResult.value);

      const userIds = await db.collection('users').find({
        [`permissions.consortia.${args.consortiumId}`]: { $exists: true }
      }, {
        projection: { _id: 1 }
      }).toArray();

      await db.collection('users').updateMany({
        [`permissions.consortia.${args.consortiumId}`]: { $exists: true }
      }, {
        $unset: {
          [`permissions.consortia.${args.consortiumId}`]: '',
          [`consortiaStatuses.${args.consortiumId}`]: ''
        }
      });

      const users = await db.collection('users').find({ _id: { $in: userIds.map(u => u._id) } }).toArray();

      eventEmitter.emit(USER_CHANGED, users);

      const pipelines = await db.collection('pipelines').find({
        owningConsortium: ObjectID(args.consortiumId)
      }).toArray();

      await db.collection('pipelines').deleteMany({
        owningConsortium: ObjectID(args.consortiumId)
      });

      eventEmitter.emit(PIPELINE_DELETED, pipelines);

      return transformToClient(deleteConsortiumResult.value);
    },
    /**
     * Deletes pipeline
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.pipelineId Pipeline id to delete
     * @return {object} Deleted pipeline
     */
    deletePipeline: async ({ auth: { credentials: { permissions } } }, args) => {
      const db = database.getDbInstance();

      const pipelineId = ObjectID(args.pipelineId);

      const pipeline = await db.collection('pipelines').findOne({ _id: pipelineId });

      if (!permissions.consortia[pipeline.owningConsortium] ||
          !permissions.consortia[pipeline.owningConsortium].includes('owner')
      ) {
        return Boom.forbidden('Action not permitted')
      }

      const runsCount = await db.collection('runs').countDocuments({
        'pipelineSnapshot.id': args.pipelineId
      });

      if (runsCount > 0) {
        return Boom.badData('Runs on this pipeline exist')
      }

      const deletePipelineResult = await db.collection('pipelines').findOneAndDelete({ _id: pipelineId });
      eventEmitter.emit(PIPELINE_DELETED, deletePipelineResult.value);

      const updateConsortiumResult = await db.collection('consortia').findOneAndUpdate({
        activePipelineId: args.pipelineId
      }, {
        $unset: { activePipelineId: '' }
      }, {
        returnOriginal: false
      });

      eventEmitter.emit(CONSORTIUM_CHANGED, updateConsortiumResult.value);

      return transformToClient(deletePipelineResult.value);
    },
    /**
     * Add logged user to consortium members list
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.consortiumId Consortium id to join
     * @return {object} Updated consortium
     */
    joinConsortium: async ({ auth: { credentials } }, args) => {
      const db = database.getDbInstance();
      let consortium = await db.collection('consortia').findOne({ _id: ObjectID(args.consortiumId) });

      if (credentials.id in consortium.members) {
        return consortium;
      }

      await addUserPermissions({ userId: ObjectID(credentials.id), userName: credentials.username, role: 'member', doc: ObjectID(args.consortiumId), table: 'consortia' });

      return helperFunctions.getUserDetails(credentials.username);
    },
    /**
     * Remove logged user from consortium members list
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.consortiumId Consortium id to join
     * @return {object} Updated consortium
     */
    leaveConsortium: async ({ auth: { credentials } }, args) => {
      await removeUserPermissions({ userId: ObjectID(credentials.id), role: 'member', doc: ObjectID(args.consortiumId), table: 'consortia' });

      return helperFunctions.getUserDetails(credentials.username);
    },
    /**
     * Deletes computation
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.computationId Computation id to delete
     * @return {object} Deleted computation
     */
    removeComputation: async ({ auth: { credentials } }, args) => {
      const db = database.getDbInstance();
      const computation = await db.collection('computations').findOne({ _id: ObjectID(args.computationId) });

      if (!computation) {
        return Boom.forbidden('Cannot find computation');
      }

      if (computation.submittedBy !== credentials.username && !isAdmin(credentials.permissions)) {
        return Boom.forbidden('Action not permitted');
      }

      const deleteComputationResult = await db.collection('computations').findOneAndDelete({ _id: ObjectID(args.computationId) });

      eventEmitter.emit(COMPUTATION_DELETED, deleteComputationResult.value);

      return transformToClient(deleteComputationResult.value);
    },
    /**
     * Add new user role to user perms, currently consortia perms only
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.userId Id of the user who will have permissions removed
     * @param {string} args.table Table of the document to add role to
     * @param {string} args.doc Id of the document to add role to
     * @param {string} args.role Role to add to perms
     * @param {string} args.userId Id of the user to be removed
     * @param {string} args.roleType Type of role to add
     * @return {object} Updated user object
     */
    removeUserRole: async ({ auth: { credentials } }, args) => {
      const { permissions } = credentials;

      if (credentials.id === args.userId) {
        return Boom.forbidden('You are not allowed to change your own permission');
      }

      if (AVAILABLE_ROLE_TYPES.indexOf(args.roleType) === -1) {
        return Boom.forbidden('Invalid role type');
      }

      if (args.roleType === 'data') {
        if (!permissions[args.table][args.doc] || !permissions[args.table][args.doc].includes('owner')) {
          return Boom.forbidden('Action not permitted');
        }

        await removeUserPermissions({ doc: ObjectID(args.doc), role: args.role, userId: ObjectID(args.userId), table: args.table });
      }

      if (args.roleType === 'app') {
        if (!isAdmin(permissions) || (AVAILABLE_USER_APP_ROLES.indexOf(args.role) === -1)) {
          return Boom.forbidden('Action not permitted');
        }

        await changeUserAppRole(args, 'remove');
      }

      return helperFunctions.getUserDetailsByID(args.userId);
    },
    /**
     * Sets active pipeline on consortia object
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.consortiumId Consortium to update
     * @param {string} args.activePipelineId Pipeline ID to mark as active
     */
    saveActivePipeline: async ({ auth: { credentials } }, args) => {
      // const { permissions } = credentials;
      /* TODO: Add permissions
      if (!permissions.consortia.write
          && args.consortium.id
          && !permissions.consortia[args.consortium.id].write) {
            return Boom.forbidden('Action not permitted');
      }*/

      const db = database.getDbInstance();

      const result = await db.collection('consortia').findOneAndUpdate({
        _id: ObjectID(args.consortiumId)
      }, {
        $set: {
          activePipelineId: ObjectID(args.activePipelineId),
          mappedForRun: []
        }
      }, {
        returnOriginal: false
      });

      eventEmitter.emit(CONSORTIUM_CHANGED, result.value);

      return transformToClient(result.value);
    },
    /**
     * Saves consortium
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {object} args.consortium Consortium object to add/update
     * @return {object} New/updated consortium object
     */
    saveConsortium: async ({ auth: { credentials } }, args) => {
      const { permissions } = credentials;

      const isUpdate = !!args.consortium.id;

      if (isUpdate && !permissions.consortia[args.consortium.id].includes('owner')) {
        return Boom.forbidden('Action not permitted');
      }

      const db = database.getDbInstance();

      const consortiumData = Object.assign(
        { ...args.consortium },
        !isUpdate && { createDate: Date.now() },
      );

      if (!isUpdate) {
        const count = await db.collection('consortia').countDocuments({
          name: args.consortium.name
        });

        if (count > 0) {
          return Boom.forbidden('Consortium with same name already exists');
        }
      }

      consortiumData.id = consortiumData.id ? ObjectID(consortiumData.id) : new ObjectID();

      if (consortiumData.activePipelineId) {
        consortiumData.activePipelineId = ObjectID(consortiumData.activePipelineId);
      }

      await db.collection('consortia').replaceOne({
        _id: consortiumData.id
      }, consortiumData, {
        upsert: true,
      });

      if (!isUpdate) {
        await addUserPermissions({ userId: ObjectID(credentials.id), userName: credentials.username, role: 'owner', doc: consortiumData.id, table: 'consortia' });
        await addUserPermissions({ userId: ObjectID(credentials.id), userName: credentials.username, role: 'member', doc: consortiumData.id, table: 'consortia' });
      }

      const consortium = await db.collection('consortia').findOne({ _id: consortiumData.id });
      return transformToClient(consortium);
    },
    /**
     * Saves run error
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.runId Run id to update
     * @param {string} args.error Error
     */
    saveError: async (_, args) => {
      const db = database.getDbInstance();

      const run = await db.collection('runs').findOne({
        _id: ObjectID(args.runId)
      }, {
        projection: { _id: 1, type: 1 }
      });

      if (!run) {
        return;
      }

      const updateObj = {
        endDate: Date.now()
      };

      if (run.type !== 'local') {
        updateObj.error = Object.assign({}, args.error);
      }

      const result = await db.collection('runs').findOneAndUpdate({
        _id: ObjectID(args.runId)
      }, {
        $set: updateObj
      }, {
        returnOriginal: false
      });

      eventEmitter.emit(RUN_CHANGED, result.value);

      return transformToClient(result.value);
    },
    /**
     * Saves pipeline
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {object} args.pipeline Pipeline object to add/update
     * @return {object} New/updated pipeline object
     */
    savePipeline: async ({ auth: { credentials } }, args) => {
      // const { permissions } = credentials;
      /* TODO: Add permissions
      if (!permissions.consortia.write
          && args.consortium.id
          && !permissions.consortia[args.consortium.id].write) {
            return Boom.forbidden('Action not permitted');
      }*/
      const db = database.getDbInstance();

      if (args.pipeline && args.pipeline.steps) {
        const invalidData = args.pipeline.steps.some(step =>
          step.inputMap &&
          step.inputMap.covariates &&
          step.inputMap.covariates.ownerMappings &&
          step.inputMap.covariates.ownerMappings.some(variable =>
            !variable.type || !variable.source || !variable.name
          )
        );

        if (invalidData) {
          return Boom.badData('Some of the covariates are incomplete');
        }
      }

      args.pipeline.id = args.pipeline.id ? ObjectID(args.pipeline.id) : new ObjectID();

      if (args.pipeline.owningConsortium) {
        args.pipeline.owningConsortium = ObjectID(args.pipeline.owningConsortium);
      }

      if (args.pipeline.steps) {
        args.pipeline.steps.forEach(step => {
          if (step.computations) {
            step.computations = step.computations.map(compId => ObjectID(compId));
          }
        });
      }

      await db.collection('pipelines').replaceOne({
        _id: args.pipeline.id
      }, args.pipeline, {
        upsert: true
      });

      const pipeline = await fetchOnePipeline(ObjectID(args.pipeline.id));
      eventEmitter.emit(PIPELINE_CHANGED, pipeline);

      return pipeline;
    },
    /**
     * Saves run results
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.runId Run id to update
     * @param {string} args.results Results
     */
    saveResults: async (_, args) => {
      const db = database.getDbInstance();

      const run = await db.collection('runs').findOne({
        _id: ObjectID(args.runId)
      }, {
        projection: { _id: 1, type: 1 }
      });

      if (!run) {
        return;
      }

      const updateObj = {
        endDate: Date.now()
      };

      if (run.type !== 'local') {
        updateObj.results = Object.assign({}, args.results);
      }

      const result = await db.collection('runs').findOneAndUpdate({
        _id: ObjectID(args.runId)
      }, {
        $set: updateObj
      }, {
        returnOriginal: false
      });

      eventEmitter.emit(RUN_CHANGED, result.value);

      return transformToClient(result.value);
    },
    setActiveComputation: (_, args) => {
      return new Promise();
    },
    setComputationInputs: (_, args) => {
      return new Promise();
    },
    /**
     * Updates run remote state
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.runId Run id to update
     * @param {string} args.data State data
     */
    updateRunState: async (_, args) => {
      const db = database.getDbInstance();

      const result = await db.collection('runs').findOneAndUpdate({
        _id: ObjectID(args.runId)
      }, {
        $set: {
          remotePipelineState: args.data,
        }
      }, {
        returnOriginal: false
      });

      eventEmitter.emit(RUN_CHANGED, result.value);

      return transformToClient(result.value);
    },
    /**
     * Saves consortium
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.consortiumId Consortium id to update
     * @param {string} args.status New status
     * @return {object} Updated user object
     */
    updateUserConsortiumStatus: async ({ auth: { credentials } }, { consortiumId, status }) => {
      const db = database.getDbInstance();

      const result = await db.collection('users').findOneAndUpdate({
        _id: ObjectID(credentials.id)
      }, {
        $set: {
          [`consortiaStatuses.${consortiumId}`]: status
        }
      }, {
        returnOriginal: false
      });

      eventEmitter.emit(USER_CHANGED, result.value);

      return transformToClient(result.value);
    },
    /**
     * Updated consortium mapped users
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.consortiumId Consortium id to update
     * @param {string} args.mappedForRun New mappedUsers
     * @return {object} Updated consortia
     */
    updateConsortiumMappedUsers: async ({ auth: { credentials } }, args) => {
      const db = database.getDbInstance();

      const result = await db.collection('consortia').findOneAndUpdate({
        _id: ObjectID(args.consortiumId)
      }, {
        $set: {
          mappedForRun: args.mappedForRun.map(id => ObjectID(id))
        }
      }, {
        returnOriginal: false
      });

      eventEmitter.emit(CONSORTIUM_CHANGED, result.value);

      return transformToClient(result.value);
    },
    /**
     * Updated consortia mapped users
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.consortia Mapped consortiums
     * @return {object} Updated consortia
     */
    updateConsortiaMappedUsers: async ({ auth: { credentials } }, args) => {
      if (!Array.isArray(args.consortia) || args.consortia.length === 0) {
        return;
      }

      const db = database.getDbInstance();

      const consortiaIds = args.consortia.map(id => ObjectID(id));

      const updatedConsortiaIds = await db.collection('consortia').find({
        _id: { $in: consortiaIds },
        mappedForRun: ObjectID(credentials.id)
      }, {
        projection: { _id: 1 }
      }).toArray();

      if (updatedConsortiaIds.length > 0) {
        await db.collection('consortia').updateMany({
          _id: { $in: consortiaIds },
          mappedForRun: ObjectID(credentials.id)
        }, {
          $pull: {
            mappedForRun: ObjectID(credentials.id)
          }
        });

        const consortia = await db.collection('consortia').find({
          _id: { $in: updatedConsortiaIds.map(c => c._id) }
        });

        eventEmitter.emit(CONSORTIUM_CHANGED, consortia);
      }
    },
    /**
     * Updated user password
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.currentPassword Current password
     * @param {string} args.newPassword New password
     * @return {boolean} Success status
     */
    updatePassword: async ({ auth: { credentials } }, args) => {
      const { currentPassword, newPassword } = args;
      const db = database.getDbInstance();

      const currentUser = await db.collection('users').findOne({ _id: ObjectID(credentials.id) });

      const isPasswordCorrect =
        await helperFunctions.verifyPassword(currentPassword, currentUser.passwordHash)

      if (!isPasswordCorrect) {
        return Boom.badData('Current password is not correct')
      }

      const newPasswordHash = await helperFunctions.hashPassword(newPassword)

      await db.collection('users').findOneAndUpdate({
        _id: ObjectID(credentials.id)
      }, {
        $set: {
          passwordHash: newPasswordHash,
        },
      }, {
        returnOriginal: false,
      });
    },
    /**
     * Save a user message
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.threadId Thread Id
     * @param {string} args.title Thread title
     * @param {array} args.recipients Message recipients
     * @param {array} args.content Message content
     * @param {object} args.action Message action
     * @return {object} Updated message
     */
    saveMessage: async ({ auth: { credentials } }, args) => {
      const { title, recipients, content, action } = args;
      const threadId = args.threadId ? ObjectID(args.threadId) : null;

      const db = database.getDbInstance();

      const messageToSave = Object.assign(
        {
          _id: new ObjectID(),
          sender: {
            id: ObjectID(credentials.id),
            username: credentials.username,
          },
          recipients,
          content,
          date: Date.now(),
        },
        action && { action },
      );

      let result;

      if (threadId) {
        const thread = await db.collection('threads').findOne({ _id: ObjectID(threadId) });

        const { users } = thread;

        const updateObj = {
          $push: {
            messages: messageToSave
          },
          $set: {
            date: Date.now(),
          }
        };

        Object.keys(users).forEach((userId) => {
          updateObj.$set[`users.${userId}`] = {
            username: users[userId],
            isRead: userId === credentials.id
          };
        });

        Object.keys(recipients).forEach((userId) => {
          if (userId in users) {
            return;
          }

          updateObj.$set[`users.${userId}`] = {
            username: recipients[userId],
            isRead: userId === credentials.id
          };
        });

        const updateResult = await db.collection('threads').findOneAndUpdate({ _id: ObjectID(threadId) }, updateObj, { returnOriginal: false });

        result = updateResult.value;
      } else {
        const thread = {
          owner: {
            id: credentials.id,
            username: credentials.username
          },
          title: title,
          messages: [messageToSave],
          users: {},
          date: Date.now(),
        };

        Object.keys(recipients).forEach((userId) => {
          thread.users[userId] = {
            username: recipients[userId],
            isRead: false,
          };
        });

        thread.users[credentials.id] = {
          username: credentials.username,
          isRead: true
        };

        const insertResult = await db.collection('threads').insertOne(thread);

        result = insertResult.ops[0];
      }

      if (action && action.type === 'share-result') {
        const updateRunResult = await db.collection('runs').findOneAndUpdate({ _id: ObjectID(action.detail.id) }, {
          $addToSet: {
            sharedUsers: { $each: Object.keys(recipients) }
          }
        }, {
          returnOriginal: false
        });

        eventEmitter.emit(RUN_CHANGED, updateRunResult.value);
      }

      eventEmitter.emit(THREAD_CHANGED, result);

      return transformToClient(result);
    },
    /**
     * Set if a user has read a message
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {string} args.threadId Thread Id
     * @param {string} args.userId User Id
     * @return {object} None
     */
    setReadMessage: async (_, args) => {
      const { threadId, userId } = args;

      const db = database.getDbInstance();

      const result = await db.collection('threads').findOneAndUpdate({
        _id: ObjectID(threadId),
      }, {
        $set: {
          [`users.${userId}.isRead`]: true,
        }
      }, {
        returnOriginal: false
      });

      eventEmitter.emit(THREAD_CHANGED, result.value);

      return transformToClient(result.value);
    },
    /**
     * Create github issue
     * @param {object} auth User object from JWT middleware validateFunc
     * @param {object} args
     * @param {object} args.issue Issue
     * @return {object} Created issue
     */
    createIssue: async ({ auth: { credentials } }, args) => {
      const { title, body } = args.issue;

      const repository = process.env.COINSTAC_REPOSITORY_NAME
      const auth = {
        username: process.env.GITHUB_BOT_USERNAME,
        password: process.env.GITHUB_ACCESS_TOKEN,
      }

      try {
        const issue = new Issue(repository, auth);

        await issue.createIssue({ title: `${credentials.username} - ${title}`, body });
      } catch (error) {
        return Boom.notAcceptable('Failed to create issue on GitHub');
      }
    },
  },
  Subscription: {
    /**
     * Computation subscription
     * @param {object} payload
     * @param {string} payload.computationId The computation changed
     * @param {object} variables
     * @param {string} variables.computationId The computation listened for
     */
    computationChanged: {
      subscribe: withFilter(
        () => pubsub.asyncIterator('computationChanged'),
        (payload, variables) => (!variables.computationId || payload.computationId === variables.computationId)
      )
    },
    /**
     * Consortium subscription
     * @param {object} payload
     * @param {string} payload.consortiumId The consortium changed
     * @param {object} variables
     * @param {string} variables.consortiumId The consortium listened for
     */
    consortiumChanged: {
      subscribe: withFilter(
        () => pubsub.asyncIterator('consortiumChanged'),
        (payload, variables) => (!variables.consortiumId || payload.consortiumId === variables.consortiumId)
      )
    },
    /**
     * Pipeline subscription
     * @param {object} payload
     * @param {string} payload.pipelineId The pipeline changed
     * @param {object} variables
     * @param {string} variables.pipelineId The pipeline listened for
     */
    pipelineChanged: {
      subscribe: withFilter(
        () => pubsub.asyncIterator('pipelineChanged'),
        (payload, variables) => (!variables.pipelineId || payload.pipelineId === variables.pipelineId)
      )
    },
    /**
     * Thread subscription
     * @param {object} payload
     * @param {string} payload.threadId The thread changed
     * @param {object} variables
     * @param {string} variables.threadId The thread listened for
     */
    threadChanged: {
      subscribe: withFilter(
        () => pubsub.asyncIterator('threadChanged'),
        (payload, variables) => (!variables.threadId || payload.threadId === variables.threadId)
      )
    },
    /**
     * User subscription
     * @param {object} payload
     * @param {string} payload.userId The user changed
     * @param {object} variables
     * @param {string} variables.userId The user listened for
     */
    userChanged: {
      subscribe: withFilter(
        () => pubsub.asyncIterator('userChanged'),
        (payload, variables) => (!variables.userId || payload.userId === variables.userId)
      )
    },
    /**
     * Run subscription
     * @param {object} payload
     * @param {string} payload.runId The run changed
     * @param {object} variables
     * @param {string} variables.userId The user listened for
     */
    userRunChanged: {
      subscribe: withFilter(
        () => pubsub.asyncIterator('userRunChanged'),
        (payload, variables) => (variables.userId && payload.userRunChanged.clients.indexOf(variables.userId) > -1)
      )
    },
  },
};

module.exports = {
  resolvers,
  pubsub,
};
