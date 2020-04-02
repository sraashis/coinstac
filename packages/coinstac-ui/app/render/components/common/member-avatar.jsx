import React from 'react';
import { compose, graphql, withApollo } from 'react-apollo';
import Avatar from 'react-avatar';
import PropTypes from 'prop-types';
import Typography from '@material-ui/core/Typography';
import DoneIcon from '@material-ui/icons/Done';
import { withStyles } from '@material-ui/core/styles';
import {
  FETCH_USER_QUERY,
} from '../../state/graphql/functions';

const styles = theme => ({
  containerStyles: {
    display: 'inline-block',
    margin: theme.spacing.unit,
    verticalAlign: 'top',
    textAlign: 'center',
    position: 'relative',
  },
  textStyles: {
    fontSize: 12,
  },
  markStyles: {
    fontSize: 14,
    color: 'white',
    backgroundColor: '#5cb85c',
    borderRadius: 14,
    position: 'absolute',
    right: -5,
    top: -5,
  },
});

function MemberAvatar({
  id,
  name,
  consRole,
  showDetails,
  width,
  classes,
  mapped,
  user,
}) {
  console.log(user);
  return (
    <div key={`${name}-avatar`} className={classes.containerStyles}>
      {user && user.photo
        ? <Avatar name={name} size={width} src={user.photo} round={true} />
        : <Avatar name={name} size={width} round={true} />}
      {
        consRole && showDetails
        && <Typography variant="subtitle2" className={classes.textStyles}>{consRole}</Typography>
      }
      {
        showDetails
        && <Typography variant="caption" className={classes.textStyles}>{name}</Typography>
      }
      {
        mapped
        && <DoneIcon className={classes.markStyles} />
      }
    </div>
  );
}

MemberAvatar.propTypes = {
  id: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  consRole: PropTypes.string,
  showDetails: PropTypes.bool,
  width: PropTypes.number.isRequired,
  classes: PropTypes.object.isRequired,
  mapped: PropTypes.bool,
};

MemberAvatar.defaultProps = {
  consRole: null,
  showDetails: false,
  mapped: false,
  user: null,
};

MemberAvatar.propTypes = {
  user: PropTypes.object,
};

const MemberAvatarWithData = compose(
  graphql(FETCH_USER_QUERY, {
    skip: props => !props.id,
    options: props => ({
      variables: { userId: props.id },
    }),
    props: props => ({
      user: props.data.fetchUser,
    }),
  }),
  withApollo
)(MemberAvatar);

export default withStyles(styles)(MemberAvatarWithData);
