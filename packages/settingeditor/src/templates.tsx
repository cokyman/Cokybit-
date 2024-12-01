/// <reference path="./typings.d.ts"/>
import React from 'react';

import { ObjectFieldTemplateProps } from 'react-jsonschema-form';
import utils from 'react-jsonschema-form/lib/utils';
import AddButton from 'react-jsonschema-form/lib/components/AddButton';

export interface IObjectFieldTemplateProps extends ObjectFieldTemplateProps {
  onAddClick: (event: any) => (event: any) => void;
  disabled?: boolean;
  readonly?: boolean;
}

export function DefaultObjectFieldTemplate(props: IObjectFieldTemplateProps) {
  const canExpand = function canExpand() {
    const { formData, schema, uiSchema } = props;
    if (!schema.additionalProperties) {
      return false;
    }
    const { expandable } = (utils as any).getUiOptions(uiSchema);
    if (expandable === false) {
      return expandable;
    }
    // if ui:options.expandable was not explicitly set to false, we can add
    // another property if we have not exceeded maxProperties yet
    if (schema.maxProperties !== undefined) {
      return Object.keys(formData).length < schema.maxProperties;
    }
    return true;
  };

  const { TitleField, DescriptionField } = props;
  return (
    <div id={props.idSchema.$id} className="fieldset">
      {(props.uiSchema['ui:title'] || props.title) && (
        <TitleField
          id={`${props.idSchema.$id}__title`}
          title={props.title || props.uiSchema['ui:title']}
          required={props.required}
          // formContext={props.formContext}
        />
      )}
      {props.description && (
        <DescriptionField
          id={`${props.idSchema.$id}__description`}
          description={props.description}
          // formContext={props.formContext}
        />
      )}
      {props.properties.map(prop => prop.content)}
      {canExpand() && (
        <AddButton
          className="object-property-expand"
          onClick={props.onAddClick(props.schema)}
          disabled={props.disabled || props.readonly}
        />
      )}
    </div>
  );
}
