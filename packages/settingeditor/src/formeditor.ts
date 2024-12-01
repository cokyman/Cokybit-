import { JSONExt, JSONObject } from '@phosphor/coreutils';

import { Toolbar, CommandToolbarButton } from '@jupyterlab/apputils';

import { SplitPanel } from './splitpanel';

import { RawEditor } from './raweditor';

import { SchemaForm } from '@jupyterlab/apputils';

import { ISettingRegistry } from '@jupyterlab/coreutils';

import { Message } from '@phosphor/messaging';

import { ISignal, Signal } from '@phosphor/signaling';

import { Widget } from '@phosphor/widgets';

export class FormEditor extends SplitPanel {
  constructor(options: RawEditor.IOptions) {
    super({
      orientation: 'horizontal',
      renderer: SplitPanel.defaultRenderer,
      spacing: 1
    });

    const { commands, registry } = options;

    this.registry = registry;
    this._commands = commands;

    this._user = new SchemaForm({});
    this._defaults = new SchemaForm({});

    this.addWidget(this._defaults);
    this.addWidget(this._user);
  }

  /**
   * The setting registry used by the editor.
   */
  readonly registry: ISettingRegistry;

  /**
   * Whether the raw editor revert functionality is enabled.
   */
  get canRevert(): boolean {
    return this._canRevert;
  }

  /**
   * Whether the raw editor save functionality is enabled.
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
    return JSONExt.deepEqual(this._user.model.formData, this._settings.user);
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

    const defaults = this._defaults;
    const user = this._user;

    // Disconnect old settings change handler.
    if (this._settings) {
      this._settings.changed.disconnect(this._onSettingsChanged, this);
    }

    if (settings) {
      this._settings = settings;
      this._settings.changed.connect(this._onSettingsChanged, this);
      this._onSettingsChanged();
      defaults.model.schema = settings.schema;
      user.model.schema = settings.schema;
    } else {
      this._settings = null;
      defaults.model.formData = {};
      user.model.formData = {};
    }

    this.update();
  }

  /**
   * Get the relative sizes of the two editor panels.
   */
  get sizes(): number[] {
    return this.relativeSizes();
  }
  set sizes(sizes: number[]) {
    this.setRelativeSizes(sizes);
  }

  /**
   * Dispose of the resources held by the raw editor.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    super.dispose();
    this._defaults.dispose();
    this._user.dispose();
  }

  /**
   * Revert the editor back to original settings.
   */
  revert(): void {
    this._user.model.formData = this.settings.user as JSONObject;
    this._updateToolbar(false, false);
  }

  /**
   * Save the contents of the raw editor.
   */
  save(): Promise<void> {
    if (!this.isDirty) {
      return Promise.resolve(undefined);
    }

    const settings = this._settings;
    const source = this._user.model.formData;

    return settings
      .save(JSON.stringify(source, null, 2))
      .then(() => {
        this._updateToolbar(false, false);
      })
      .catch(reason => {
        this._updateToolbar(true, false);
        this._onSaveError(reason);
      });
  }

  /**
   * Handle `after-attach` messages.
   */
  protected onAfterAttach(msg: Message): void {
    Private.populateToolbar(this._commands, this._toolbar);
    this.update();
  }

  /**
   * Handle updates to the settings.
   */
  private _onSettingsChanged(): void {
    const settings = this._settings;
    // const defaults = this._defaults;
    const user = this._user;

    // defaults.model.formData = settings.default;
    user.model.formData = settings.user as JSONObject;
  }

  private _updateToolbar(revert = this._canRevert, save = this._canSave): void {
    const commands = this._commands;

    this._canRevert = revert;
    this._canSave = save;
    this._commandsChanged.emit([commands.revert, commands.save]);
  }

  private _canRevert = false;
  private _canSave = false;
  private _commands: RawEditor.ICommandBundle;
  private _commandsChanged = new Signal<this, string[]>(this);
  private _defaults: SchemaForm<JSONObject>;
  // private _inspector: Widget;
  private _onSaveError: (reason: any) => void;
  private _settings: ISettingRegistry.ISettings | null = null;
  private _toolbar = new Toolbar<Widget>();
  private _user: SchemaForm<JSONObject>;
}

/**
 * A namespace for private module data.
 */
namespace Private {
  /**
   * Populate the raw editor toolbar.
   */
  export function populateToolbar(
    commands: RawEditor.ICommandBundle,
    toolbar: Toolbar<Widget>
  ): void {
    const { registry, revert, save } = commands;

    toolbar.addItem('spacer', Toolbar.createSpacerItem());

    // Note the button order. The rationale here is that no matter what state
    // the toolbar is in, the relative location of the revert button in the
    // toolbar remains the same.
    [revert, save].forEach(name => {
      const item = new CommandToolbarButton({ commands: registry, id: name });
      toolbar.addItem(name, item);
    });
  }
}
