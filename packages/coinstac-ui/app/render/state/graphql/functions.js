import { gql } from 'react-apollo';
import { mutations, queries } from 'coinstac-graphql-schema';

export const ADD_COMPUTATION_MUTATION = gql`
  mutation addComputation($computationSchema: ComputationInput!) 
    ${mutations.addComputation}
`;

export const ADD_USER_ROLE_MUTATION = gql`
  mutation addUserRole($userId: ID!, $table: String!, $doc: String!, $role: String!)
    ${mutations.addUserRole}
`;

export const COMPUTATION_CHANGED_SUBSCRIPTION = gql`
  subscription computationChanged($computationId: ID)
    ${queries.computationChanged}
`;

export const CONSORTIUM_CHANGED_SUBSCRIPTION = gql`
  subscription consortiumChanged($consortiumId: ID)
    ${queries.consortiumChanged}
`;

export const DELETE_CONSORTIUM_MUTATION = gql`
  mutation deleteConsortiumById($consortiumId: ID!) {
    deleteConsortiumById(consortiumId: $consortiumId){
      id
    }
  }
`;

export const DELETE_PIPELINE_MUTATION = gql`
  mutation deletePipeline($pipelineId: ID!) {
    deletePipeline(pipelineId: $pipelineId){
      id
    }
  }
`;

export const FETCH_ALL_PIPELINES_QUERY = gql`
  query fetchAllPipelines
    ${queries.fetchAllPipelines}
`;

export const FETCH_ALL_COMPUTATIONS_QUERY = gql`
  query fetchAllComputations
    ${queries.fetchAllComputations}
`;

export const FETCH_ALL_CONSORTIA_QUERY = gql`
  query fetchAllConsortia
    ${queries.fetchAllConsortia}
`;

export const FETCH_CONSORTIUM_QUERY = gql`
  query fetchConsortium ($consortiumId: ID)
    ${queries.fetchConsortium}
`;

export const FETCH_COMPUTATION_QUERY = gql`
  query fetchComputation ($computationIds: [ID])
    ${queries.fetchComputation}
`;

export const FETCH_PIPELINE_QUERY = gql`
  query fetchPipeline ($pipelineId: ID)
    ${queries.fetchPipeline}
`;

export const JOIN_CONSORTIUM_MUTATION = gql`
  mutation joinConsortium($consortiumId: ID!) {
    joinConsortium(consortiumId: $consortiumId){
      id
      members
    }
  }
`;

export const LEAVE_CONSORTIUM_MUTATION = gql`
  mutation leaveConsortium($consortiumId: ID!) {
    leaveConsortium(consortiumId: $consortiumId){
      id
      members
    }
  }
`;

export const PIPELINE_CHANGED_SUBSCRIPTION = gql`
  subscription pipelineChanged($pipelineId: ID)
    ${queries.pipelineChanged}
`;

export const REMOVE_COMPUTATION_MUTATION = gql`
  mutation removeComputation($computationId: ID!) {
    removeComputation(computationId: $computationId){
      id
    }
  }
`;

export const REMOVE_USER_ROLE_MUTATION = gql`
  mutation removeUserRole($userId: ID!, $table: String!, $doc: String!, $role: String!)
    ${mutations.removeUserRole}
`;

export const SAVE_ACTIVE_PIPELINE_MUTATION = gql`
  mutation saveActivePipeline($consortiumId: ID, $activePipeline: ID){
    saveActivePipeline(consortiumId: $consortiumId, activePipeline: $activePipeline)
  }
`;

export const SAVE_CONSORTIUM_MUTATION = gql`
  mutation saveConsortium($consortium: ConsortiumInput!)
    ${mutations.saveConsortium}
`;

export const SAVE_PIPELINE_MUTATION = gql`
  mutation savePipeline($pipeline: PipelineInput!)
    ${mutations.savePipeline}
`;