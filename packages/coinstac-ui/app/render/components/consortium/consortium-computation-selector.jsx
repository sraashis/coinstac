import React from 'react';
import PropTypes from 'prop-types';
import { chain } from 'lodash';

const getFirstTag = c => c.meta.tags[0];

export default function ConsortiumComputationSelector({
  computations,
  input,
  meta,
}) {
  let radioClassNames = 'consortium-computation-selector-radio radio';
  let helpBlock;

  if (meta.touched && meta.error) {
    helpBlock = <span className="help-block">{meta.error}</span>;
    radioClassNames += ' has-error';
  }

  /**
   * @todo Don't hard-code the 'FreeSurfer Regressions' label. Determine a way
   * to map computation tags to human-readable names.
   */
  const computationsFields = chain(computations)
    .sortBy(getFirstTag)
    .groupBy(getFirstTag)
    .map((comps, tag) => (
      <fieldset className="consortium-computation-selector-group" key={tag}>
        <legend className="consortium-computation-selector-label">
          FreeSurfer Regressions
        </legend>
        {comps.map(
          (
            {
              _id,
              meta: { description, name },
              version,
            }
          ) => {
            const isChecked = input.value === _id;

            return (
              <div className={radioClassNames} key={_id}>
                <label htmlFor={`computation-radio-${_id}`}>
                  <input
                    checked={isChecked}
                    className="sr-only"
                    onChange={input.onChange}
                    name={input.name}
                    type="radio"
                    value={_id}
                    id={`computation-radio-${_id}`}
                  />
                  <span
                    aria-hidden="true"
                    className={`glyphicon glyphicon-${isChecked ? 'check' : 'unchecked'}`}
                  />
                  <h3 className="h5">{name} <small>Version {version}</small></h3>
                  <p>{description}</p>
                </label>
              </div>
            );
          }
        )}
      </fieldset>
    ))
    .value();

  return (
    <div className="consortium-computation-selector">
      {helpBlock}
      {computationsFields}
    </div>
  );
}

ConsortiumComputationSelector.propTypes = {
  computations: PropTypes.array,
  input: PropTypes.object,
  meta: PropTypes.object,
};

ConsortiumComputationSelector.defaultProps = {
  computations: null,
  input: null,
  meta: null,
};
