const { EventEmitter } = require('events');

const COMPUTATION_CHANGED = 'COMPUTATION_CHANGED';
const COMPUTATION_DELETED = 'COMPUTATION_DELETED';

const CONSORTIUM_CHANGED = 'CONSORTIUM_CHANGED';
const CONSORTIUM_DELETED = 'CONSORTIUM_DELETED';
const CONSORTIUM_PIPELINE_CHANGED = 'CONSORTIUM_PIPELINE_CHANGED';

const PIPELINE_CHANGED = 'PIPELINE_CHANGED';
const PIPELINE_DELETED = 'PIPELINE_DELETED';

const RUN_CHANGED = 'RUN_CHANGED';

const RUN_WITH_HEADLESS_CLIENT_STARTED = 'RUN_WITH_HEADLESS_CLIENT_STARTED';

const THREAD_CHANGED = 'THREAD_CHANGED';

const USER_CHANGED = 'USER_CHANGED';

const USER_SESSION_STARTED = 'USER_SESSION_STARTED';
const USER_SESSION_FINISHED = 'USER_SESSION_FINISHED';

const WS_CONNECTION_STARTED = 'WS_CONNECTION_STARTED';
const WS_CONNECTION_TERMINATED = 'WS_CONNECTION_TERMINATED';

const eventEmitter = new EventEmitter();

module.exports = {
  eventEmitter,
  COMPUTATION_CHANGED,
  COMPUTATION_DELETED,
  CONSORTIUM_CHANGED,
  CONSORTIUM_DELETED,
  CONSORTIUM_PIPELINE_CHANGED,
  PIPELINE_CHANGED,
  PIPELINE_DELETED,
  RUN_CHANGED,
  RUN_WITH_HEADLESS_CLIENT_STARTED,
  THREAD_CHANGED,
  USER_CHANGED,
  USER_SESSION_STARTED,
  USER_SESSION_FINISHED,
  WS_CONNECTION_STARTED,
  WS_CONNECTION_TERMINATED,
};
