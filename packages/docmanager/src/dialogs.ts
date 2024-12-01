// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  Dialog,
  showDialog,
  showErrorMessage,
  SchemaForm
} from '@jupyterlab/apputils';

import { PathExt } from '@jupyterlab/coreutils';

import { Contents } from '@jupyterlab/services';

import { JSONObject } from '@phosphor/coreutils';

import { IDocumentManager } from './';

/**
 * The class name added to file dialogs.
 */
const FILE_DIALOG_CLASS = 'jp-FileDialog';

/**
 * A stripped-down interface for a file container.
 */
export interface IFileContainer extends JSONObject {
  /**
   * The list of item names in the current working directory.
   */
  items: string[];
  /**
   * The current working directory of the file container.
   */
  path: string;
}

interface IFormData extends JSONObject {
  oldPath: string;
  newPath: string;
}

/**
 * Rename a file with a dialog.
 */
export function renameDialog(
  manager: IDocumentManager,
  oldPath: string
): Promise<Contents.IModel | null> {
  const form = new SchemaForm<IFormData>(Private.makeSchema(oldPath), {
    className: FILE_DIALOG_CLASS,
    uiSchema: Private.makeUiSchema(),
    liveValidate: true,
    showErrorList: false
  });

  return showDialog({
    title: 'Rename File',
    body: form,
    focusNodeSelector: 'input:not([readonly])',
    buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Rename' })]
  }).then(result => {
    if (!result.value) {
      return;
    }
    const { errors, formData } = result.value;
    if (errors.length) {
      void showErrorMessage(
        'Rename Error',
        Error(
          `"${formData.newPath}" is not a valid name for a file. ` +
            `Names must have nonzero length, ` +
            `and cannot include "/", "\\", or ":"`
        )
      );
      return null;
    }
    let basePath = PathExt.dirname(oldPath);
    let newPath = PathExt.join(basePath, formData.newPath);
    return renameFile(manager, oldPath, newPath);
  });
}

/**
 * Rename a file, asking for confirmation if it is overwriting another.
 */
export function renameFile(
  manager: IDocumentManager,
  oldPath: string,
  newPath: string
): Promise<Contents.IModel | null> {
  return manager.rename(oldPath, newPath).catch(error => {
    if (error.message.indexOf('409') === -1) {
      throw error;
    }
    return shouldOverwrite(newPath).then(value => {
      if (value) {
        return manager.overwrite(oldPath, newPath);
      }
      return Promise.reject('File not renamed');
    });
  });
}

/**
 * Ask the user whether to overwrite a file.
 */
export function shouldOverwrite(path: string): Promise<boolean> {
  let options = {
    title: 'Overwrite file?',
    body: `"${path}" already exists, overwrite?`,
    buttons: [Dialog.cancelButton(), Dialog.warnButton({ label: 'Overwrite' })]
  };
  return showDialog(options).then(result => {
    return Promise.resolve(result.button.accept);
  });
}

/**
 * Test whether a name is a valid file name
 *
 * Disallows "/", "\", and ":" in file names, as well as names with zero length.
 */
export function isValidFileName(name: string): boolean {
  const validNameExp = /[\/\\:]/;
  return name.length > 0 && !validNameExp.test(name);
}

/**
 * A namespace for private data.
 */
namespace Private {
  /**
   * Create the JSON Schema for file renaming
   */
  export function makeSchema(oldPath: string) {
    return {
      type: 'object',
      required: ['newPath'],
      properties: {
        oldPath: {
          type: 'string',
          title: 'File Path',
          default: oldPath,
          readOnly: true
        },
        newPath: {
          type: 'string',
          title: 'New Name',
          // can't quite reproduce basename selection:
          // https://github.com/rjsf-team/react-jsonschema-form/issues/744
          default: PathExt.basename(oldPath),
          pattern: '[^\\/\\\\:]+'
        }
      }
    };
  }

  /**
   * Create the UI schema for file renaming
   */
  export function makeUiSchema() {
    return {
      newPath: {
        'ui:autofocus': true
      }
    };
  }
}
