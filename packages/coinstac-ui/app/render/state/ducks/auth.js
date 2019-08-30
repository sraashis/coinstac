import axios from 'axios';
import ipcPromise from 'ipc-promise';
import { remote } from 'electron';
import { applyAsyncLoading } from './loading';
import { get } from 'lodash';

const CoinstacClientCore = require('coinstac-client-core');

const apiServer = remote.getGlobal('config').get('apiServer');
const API_URL = `${apiServer.protocol}//${apiServer.hostname}${apiServer.port ? `:${apiServer.port}` : ''}${apiServer.pathname}`;

const getErrorDetail = error => ({
  message: get(error, 'response.data.message'),
  statusCode: get(error, 'response.status')
});

const INITIAL_STATE = {
  user: {
    id: '',
    username: '',
    permissions: {},
    email: '',
    institution: '',
    consortiaStatuses: {},
  },
  appDirectory: localStorage.getItem('appDirectory') || CoinstacClientCore.getDefaultAppDirectory(),
  isApiVersionCompatible: true,
  error: null,
};

// Actions
const SET_USER = 'SET_USER';
const CLEAR_USER = 'CLEAR_USER';
const SET_ERROR = 'SET_ERROR';
const CLEAR_ERROR = 'CLEAR_ERROR';
const UPDATE_USER_CONSORTIA_STATUSES = 'UPDATE_USER_CONSORTIA_STATUSES';
const UPDATE_USER_PERMS = 'UPDATE_USER_PERMS';
const SET_APP_DIRECTORY = 'SET_APP_DIRECTORY';
const SET_API_VERSION_CHECK = 'SET_API_VERSION_CHECK';

// Action Creators
export const setUser = user => ({ type: SET_USER, payload: user });
export const clearUser = () => ({ type: CLEAR_USER });
export const setError = error => ({ type: SET_ERROR, payload: error });
export const clearError = () => ({ type: CLEAR_ERROR });
export const updateUserConsortiaStatuses = statuses => ({
  type: UPDATE_USER_CONSORTIA_STATUSES,
  payload: statuses,
});
export const updateUserPerms = perms => ({ type: UPDATE_USER_PERMS, payload: perms });
export const setAppDirectory = appDirectory => ({ type: SET_APP_DIRECTORY, payload: appDirectory });
export const setApiVersionCheck = isApiVersionCompatible => ({
  type: SET_API_VERSION_CHECK,
  payload: isApiVersionCompatible,
});

// Helpers
const initCoreAndSetToken = (reqUser, data, appDirectory, dispatch) => {
  if (appDirectory) {
    localStorage.setItem('appDirectory', appDirectory);
  }

  return ipcPromise.send('login-init', { userId: reqUser.username, appDirectory })
    .then(() => {
      const user = { ...data.user, label: reqUser.username };

      if (reqUser.saveLogin) {
        localStorage.setItem('id_token', data.id_token);
      } else {
        sessionStorage.setItem('id_token', data.id_token);
      }

      dispatch(setUser(user));
    });
};

export const autoLogin = applyAsyncLoading(() => (dispatch, getState) => {
  let token = localStorage.getItem('id_token');
  let saveLogin = true;

  if (!token || token === 'null' || token === 'undefined') {
    token = sessionStorage.getItem('id_token');
    saveLogin = false;
  }

  if (!token || token === 'null' || token === 'undefined') {
    return;
  }

  return axios.post(
    `${API_URL}/authenticateByToken`,
    null,
    { headers: { Authorization: `Bearer ${token}` } }
  )
    // TODO: GET RID OF CORE INIT
    .then(({ data }) => {
      const { auth: { appDirectory } } = getState();
      return initCoreAndSetToken(
        { username: data.user.id, saveLogin, password: 'password' },
        data,
        appDirectory,
        dispatch
      );
    })
    .catch((err) => {
      if (err.response) {
        dispatch(logout());
        const { statusCode, message } = getErrorDetail(err);
        if (statusCode === 401) {
          dispatch(setError(message || 'Please Login Again'));
        } else {
          dispatch(setError('An unexpected error has occurred'));
        }
      } else {
        dispatch(setError('Server not responding'));
      }
    });
});

export const checkApiVersion = applyAsyncLoading(() => dispatch => axios.get(`${API_URL}/version`)
  .then(({ data }) => {
    const versionsMatch = process.env.NODE_ENV !== 'production' || data === remote.app.getVersion();
    dispatch(setApiVersionCheck(versionsMatch));
  })
  .catch(() => {
    dispatch(setError('An unexpected error has occurred'));
  }));

export const login = applyAsyncLoading(({ username, password, saveLogin }) => (dispatch, getState) => axios.post(`${API_URL}/authenticate`, { username, password })
  .then(({ data }) => {
    const { auth: { appDirectory } } = getState();
    return initCoreAndSetToken({ username, password, saveLogin }, data, appDirectory, dispatch);
  })
  .catch((err) => {
    if (err.response) {
      const { statusCode } = getErrorDetail(err);

      if (statusCode === 401) {
        dispatch(setError('Username and/or Password Incorrect'));
      } else {
        dispatch(setError('An unexpected error has occurred'));
      }
    } else {
      dispatch(setError('Server not responding'));
    }
  }));

export const logout = applyAsyncLoading(() => (dispatch) => {
  localStorage.removeItem('id_token');
  sessionStorage.removeItem('id_token');
  dispatch(clearUser());
});

export const signUp = applyAsyncLoading(user => (dispatch, getState) => axios.post(`${API_URL}/createAccount`, user)
  .then(({ data }) => {
    const { auth: { appDirectory } } = getState();
    return initCoreAndSetToken(user, data, appDirectory, dispatch);
  })
  .catch((err) => {
    const { message } = getErrorDetail(err);
    if (message === 'Username taken' || message === 'Email taken') {
      dispatch(setError(message));
    }
  }));

export default function reducer(state = INITIAL_STATE, { type, payload }) {
  switch (type) {
    case SET_USER:
      return { ...state, user: payload };
    case CLEAR_USER:
      return { ...state, user: { ...INITIAL_STATE.user } };
    case SET_ERROR:
      return { ...state, error: payload };
    case CLEAR_ERROR:
      return { ...state, error: null };
    case UPDATE_USER_CONSORTIA_STATUSES:
      return { ...state, user: { ...state.user, consortiaStatuses: payload } };
    case UPDATE_USER_PERMS:
      return { ...state, user: { ...state.user, permissions: payload } };
    case SET_APP_DIRECTORY:
      return { ...state, appDirectory: payload };
    case SET_API_VERSION_CHECK:
      return { ...state, isApiVersionCompatible: payload };
    default:
      return state;
  }
}
