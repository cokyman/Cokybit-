// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { ThemeProps } from 'react-jsonschema-form';
import { getDefaultRegistry } from 'react-jsonschema-form/lib/utils';

const { fields, widgets } = getDefaultRegistry();

const Theme: ThemeProps = {
  fields: { ...fields }, // ...Fields },
  widgets: { ...widgets } // ...Widgets },
};

export default Theme;
