// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { ISettingRegistry } from '@jupyterlab/coreutils';

import { CommandRegistry } from '@phosphor/commands';

import { Message } from '@phosphor/messaging';

import { ISignal, Signal } from '@phosphor/signaling';

import { Widget } from '@phosphor/widgets';

import * as React from 'react';

import * as ReactDom from 'react-dom';

import Form from 'react-jsonschema-form';

import {DefaultObjectFieldTemplate} from './templates';

import '../style/formeditor.css';

/**
 * A class name added to all form editors.
 */
const FORM_EDITOR_CLASS = 'jp-SettingsFormEditor';

/**
 * A JSON-schema form settings editor.
 */
export class FormEditor extends Widget {
  /**
   * Create a new form editor.
   */
  constructor(options: FormEditor.IOptions) {
    super();

    const { commands, registry } = options;

    this.registry = registry;
    this._commands = commands;

    this.addClass(FORM_EDITOR_CLASS);
    this._onSaveError = options.onSaveError;
  }

  /**
   * The setting registry used by the editor.
   */
  readonly registry: ISettingRegistry;

  /**
   * Whether the form editor revert functionality is enabled.
   */
  get canRevert(): boolean {
    return this._canRevert;
  }

  /**
   * Whether the form editor save functionality is enabled.
   */
  get canSave(): boolean {
    return this._canSave;
  }

  /**
   * Emits when the commands passed in at instantiation change.
   */
  get commandsChanged(): ISignal<any, string[]> {
    return this._commandsChanged;
  }

  /**
   * Tests whether the settings have been modified and need saving.
   */
  get isDirty(): boolean {
    return this._isDirty;
  }

  /**
   * The plugin settings being edited.
   */
  get settings(): ISettingRegistry.ISettings | null {
    return this._settings;
  }
  set settings(settings: ISettingRegistry.ISettings | null) {
    if (!settings && !this._settings) {
      return;
    }

    const samePlugin =
      settings && this._settings && settings.plugin === this._settings.plugin;

    if (samePlugin) {
      return;
    }

    // Disconnect old settings change handler.
    if (this._settings) {
      this._settings.changed.disconnect(this._onSettingsChanged, this);
    }

    if (settings) {
      this._settings = settings;
      this._settings.changed.connect(
        this._onSettingsChanged,
        this
      );
      this._onSettingsChanged();
    } else {
      this._settings = null;
    }

    this.update();
  }

  /**
   * Dispose of the resources held by the raw editor.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    super.dispose();
  }

  /**
   * Revert the editor back to original settings.
   */
  revert(): void {
    /* no op */
  }

  /**
   * Save the contents of the raw editor.
   */
  save(): Promise<void> {
    if (!this.isDirty) {
      return Promise.resolve(undefined);
    }

    const settings = this._settings;

    return settings
      .save(JSON.stringify(this._formData, null, 2))
      .then(() => {
        console.log('saved!');
      })
      .catch(reason => {
        this._onSaveError(reason);
      });
  }

  /**
   * Handle `after-attach` messages.
   */
  protected onAfterAttach(msg: Message): void {
    this.update();
  }

  /**
   * Handle `'update-request'` messages.
   */
  protected onUpdateRequest(msg: Message): void {
    if (!this._settings) {
      return;
    }

    ReactDom.render(
      <Form
        schema={this._settings.schema}
        formData={this.settings.composite}
        liveValidate={true}
        ObjectFieldTemplate={DefaultObjectFieldTemplate}
        onSubmit={(evt: any) => this.save()}
        onChange={(evt: any) => {
          this._formData = evt.formData;
          this._isDirty = true;
        }}
      />,
      this.node
    );
  }

  /**
   * Handle updates to the settings.
   */
  private _onSettingsChanged(): void {
    /* no-op */
    console.log(this._commands);
  }

  private _canRevert = false;
  private _canSave = false;
  private _commands: FormEditor.ICommandBundle;
  private _commandsChanged = new Signal<this, string[]>(this);
  private _onSaveError: (reason: any) => void;
  private _settings: ISettingRegistry.ISettings | null = null;
  private _formData: any;
  private _isDirty = false;
}

/**
 * A namespace for `FormEditor` statics.
 */
export namespace FormEditor {
  /**
   * The toolbar commands and registry for the setting editor toolbar.
   */
  export interface ICommandBundle {
    /**
     * The command registry.
     */
    registry: CommandRegistry;

    /**
     * The debug command ID.
     */
    debug: string;

    /**
     * The revert command ID.
     */
    revert: string;

    /**
     * The save command ID.
     */
    save: string;
  }

  /**
   * The instantiation options for a raw editor.
   */
  export interface IOptions {
    /**
     * The toolbar commands and registry for the setting editor toolbar.
     */
    commands: ICommandBundle;

    /**
     * A function the raw editor calls on save errors.
     */
    onSaveError: (reason: any) => void;

    /**
     * The setting registry used by the editor.
     */
    registry: ISettingRegistry;
  }
}
