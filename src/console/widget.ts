// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  IKernel, ISession, KernelMessage
} from 'jupyter-js-services';

import {
  showDialog
} from '../dialog';

import {
  RenderMime, MimeMap
} from '../rendermime';

import {
  Message
} from 'phosphor-messaging';

import {
  clearSignalData
} from 'phosphor-signaling';

import {
  Widget
} from 'phosphor-widget';

import {
  PanelLayout, Panel
} from 'phosphor-panel';

import {
  CodeCellWidget, CodeCellModel, RawCellModel, RawCellWidget
} from '../notebook/cells';

import {
  EdgeLocation, CellEditorWidget, ITextChange, ICompletionRequest
} from '../notebook/cells/editor';

import {
  mimetypeForLanguage
} from '../notebook/common/mimetype';

import {
  nbformat
} from '../notebook';

import {
  ConsoleTooltip
} from './tooltip';

import {
  ConsoleHistory, IConsoleHistory
} from './history';

import {
  CompletionWidget, CompletionModel, CellCompletionHandler
} from '../notebook/completion';


/**
 * The class name added to console widgets.
 */
const CONSOLE_CLASS = 'jp-Console';

/**
 * The class name added to console panels.
 */
const CONSOLE_PANEL = 'jp-Console-panel';

/**
 * The class name added to the console banner.
 */
const BANNER_CLASS = 'jp-Console-banner';

/**
 * The class name of the active prompt
 */
const PROMPT_CLASS = 'jp-Console-prompt';


/**
 * A panel which contains a toolbar and a console.
 */
export
class ConsolePanel extends Panel {
  /**
   * Construct a console panel.
   */
  constructor(options: ConsolePanel.IOptions) {
    super();
    this.addClass(CONSOLE_PANEL);
    this._console = new ConsoleWidget({
      session: options.session,
      rendermime: options.rendermime
    });
    this.addChild(this._console);
  }

  /**
   * The console widget used by the panel.
   *
   * #### Notes
   * This is a read-only property.
   */
  get content(): ConsoleWidget {
    return this._console;
  }

  /**
   * Dispose of the resources held by the widget.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._console.dispose();
    this._console = null;
    super.dispose();
  }

  /**
   * Handle the DOM events for the widget.
   *
   * @param event - The DOM event sent to the widget.
   *
   * #### Notes
   * This method implements the DOM `EventListener` interface and is
   * called in response to events on the dock panel's node. It should
   * not be called directly by user code.
   */
  handleEvent(event: Event): void {
    switch (event.type) {
    case 'click':
      let prompt = this.content.prompt;
      if (prompt) {
        prompt.focus();
      }
      break;
    default:
      break;
    }
  }

  /**
   * Handle `after_attach` messages for the widget.
   */
  protected onAfterAttach(msg: Message): void {
    this.content.node.addEventListener('click', this);
  }

  /**
   * Handle `before_detach` messages for the widget.
   */
  protected onBeforeDetach(msg: Message): void {
    this.content.node.removeEventListener('click', this);
  }

  /**
   * Handle `'close-request'` messages.
   */
  protected onCloseRequest(msg: Message): void {
    let session = this.content.session;
    if (!session.kernel) {
      this.dispose();
    }
    session.kernel.getKernelSpec().then(spec => {
      let name = spec.display_name;
      return showDialog({
        title: 'Shut down kernel?',
        body: `Shut down ${name}?`
      });
    }).then(value => {
      if (value && value.text === 'OK') {
        return session.shutdown();
      }
    }).then(() => {
      super.onCloseRequest(msg);
      this.dispose();
    });
  }

  private _console: ConsoleWidget = null;
}


/**
 * A namespace for ConsolePanel statics.
 */
export
namespace ConsolePanel {
  /**
   * The initialization options for a console panel.
   */
  export
    interface IOptions {
    /**
     * The session for the console panel.
     */
    session: ISession;

    /**
     * The mime renderer for the console panel.
     */
    rendermime: RenderMime<Widget>;
  }
}


/**
 * A widget containing a Jupyter console.
 */
export
class ConsoleWidget extends Widget {
  /**
   * Construct a console widget.
   */
  constructor(options: ConsoleWidget.IOptions) {
    super();
    this.addClass(CONSOLE_CLASS);

    let layout = new PanelLayout();

    this.layout = layout;
    this._renderer = options.renderer || ConsoleWidget.defaultRenderer;
    this._rendermime = options.rendermime;
    this._session = options.session;

    this._history = new ConsoleHistory(this._session.kernel);

    // Instantiate tab completion widget.
    let completion = options.completion || new CompletionWidget({
      model: new CompletionModel()
    });
    this._completion = completion;

    // Set the completion widget's anchor node to peg its position.
    completion.anchor = this.node;

    // Because a completion widget may be passed in, check if it is attached.
    if (!completion.isAttached) {
      completion.attach(document.body);
    }

    completion.visibilityChanged.connect(this.onCompletionVisibility, this);

    this._completionHandler = new CellCompletionHandler(this._completion);
    this._completionHandler.kernel = this._session.kernel;

    // Instantiate tooltip widget.
    this._tooltip = options.tooltip || new ConsoleTooltip();
    this._tooltip.reference = this;
    // Because a tooltip widget may be passed in, check if it is attached.
    if (!this._tooltip.isAttached) {
      this._tooltip.attach(document.body);
    }

    // Create the banner.
    let banner = this._renderer.createBanner();
    banner.addClass(BANNER_CLASS);
    banner.readOnly = true;
    banner.model.source = '...';
    layout.addChild(banner);

    // Set the banner text and the mimetype.
    this.initialize();

    // Create the prompt.
    this.newPrompt();

    // Handle changes to the kernel.
    this._session.kernelChanged.connect((s, kernel) => {
      this.clear();
      this.newPrompt();
      this.initialize();
      this._history.dispose();
      this._history = new ConsoleHistory(kernel);
      this._completionHandler.kernel = kernel;
    });
  }

  /*
   * The last cell in a console is always a `CodeCellWidget` prompt.
   */
  get prompt(): CodeCellWidget {
    let layout = this.layout as PanelLayout;
    let last = layout.childCount() - 1;
    return last > 0 ? layout.childAt(last) as CodeCellWidget : null;
  }

  /**
   * Get the session used by the console.
   *
   * #### Notes
   * This is a read-only property.
   */
  get session(): ISession {
    return this._session;
  }

  /**
   * Dispose of the resources held by the widget.
   */
  dispose() {
    // Do nothing if already disposed.
    if (this.isDisposed) {
      return;
    }
    this._tooltip.dispose();
    this._tooltip = null;
    this._history.dispose();
    this._history = null;
    this._completionHandler.dispose();
    this._completionHandler = null;
    this._completion.dispose();
    this._completion = null;
    this._session.dispose();
    this._session = null;
    super.dispose();
  }

  /**
   * Execute the current prompt.
   */
  execute(): Promise<void> {
    // Dismiss any outstanding tooltips or completion widgets.
    this.dismissOverlays();

    if (this._session.status === 'dead') {
      return;
    }

    let prompt = this.prompt;
    prompt.trusted = true;
    this._history.push(prompt.model.source);
    // Create a new prompt before kernel execution to allow typeahead.
    this.newPrompt();
    return prompt.execute(this._session.kernel).then(
      () => { Private.scrollToBottom(this.node); },
      () => { Private.scrollToBottom(this.node); }
    );
  }

  /**
   * Clear the code cells.
   */
  clear(): void {
    while (this.prompt) {
      this.prompt.dispose();
    }
    this.newPrompt();
  }

  /**
   * Dismiss the tooltip and completion widget for a console.
   */
  dismissOverlays(): void {
    this._tooltip.hide();
    this._completion.reset();
  }

  /**
   * Serialize the output.
   */
  serialize(): nbformat.ICodeCell[] {
    let output: nbformat.ICodeCell[] = [];
    let layout = this.layout as PanelLayout;
    for (let i = 1; i < layout.childCount(); i++) {
      let widget = layout.childAt(i) as CodeCellWidget;
      output.push(widget.model.toJSON());
    }
    return output;
  }

  /**
   * Handle `after_attach` messages for the widget.
   */
  protected onAfterAttach(msg: Message): void {
    let prompt = this.prompt;
    if (prompt) {
      prompt.focus();
    }
  }

  /**
   * Handle visiblity changes in the completion widget.
   */
  protected onCompletionVisibility(): void {
    if (this._completion.isVisible) {
      this._tooltip.hide();
    }
  }

  /**
   * Handle an edge requested signal.
   */
  protected onEdgeRequest(editor: CellEditorWidget, location: EdgeLocation): void {
    let prompt = this.prompt;
    if (location === 'top') {
      this._history.back().then(value => {
        if (!value) {
          return;
        }
        prompt.model.source = value;
        prompt.editor.setCursorPosition(0);
      });
    } else {
      this._history.forward().then(value => {
        // If at the bottom end of history, then clear the prompt.
        let text = value || '';
        prompt.model.source = text;
        prompt.editor.setCursorPosition(text.length);
      });
    }
  }

  /**
   * Handle a text changed signal from an editor.
   */
  protected onTextChange(editor: CellEditorWidget, change: ITextChange): void {
    this._tooltip.hide();
    if (change.newValue) {
      this.updateTooltip(change);
    }
  }

  /**
   * Handle `update_request` messages.
   */
  protected onUpdateRequest(msg: Message): void {
    let prompt = this.prompt;
    Private.scrollIfNeeded(this.parent.node, prompt.node);
  }

  /**
   * Initialize the banner and mimetype.
   */
  protected initialize(): void {
    let layout = this.layout as PanelLayout;
    let banner = layout.childAt(0) as RawCellWidget;
    this._session.kernel.kernelInfo().then(msg => {
      let info = msg.content;
      banner.model.source = info.banner;
      this._mimetype = mimetypeForLanguage(info.language_info);
      this.prompt.mimetype = this._mimetype;
    });
  }

  /**
   * Make a new prompt.
   */
  protected newPrompt(): void {
    // Make the previous editor read-only and clear its signals.
    let prompt = this.prompt;
    if (prompt) {
      prompt.readOnly = true;
      prompt.removeClass(PROMPT_CLASS);
      clearSignalData(prompt.editor);
    }

    // Create the new prompt and add to layout.
    let layout = this.layout as PanelLayout;
    prompt = this._renderer.createPrompt(this._rendermime);
    prompt.mimetype = this._mimetype;
    prompt.addClass(PROMPT_CLASS);
    layout.addChild(prompt);

    // Hook up completion, tooltip, and history handling.
    let editor = prompt.editor;
    editor.textChanged.connect(this.onTextChange, this);
    editor.edgeRequested.connect(this.onEdgeRequest, this);

    // Associate the new prompt with the completion handler.
    this._completionHandler.activeCell = prompt;

    // Jump to the bottom of the console.
    Private.scrollToBottom(this.node);

    prompt.focus();
  }

  /**
   * Show the tooltip.
   */
  protected showTooltip(change: ITextChange, bundle: MimeMap<string>): void {
    // Add content and measure.
    this._tooltip.content = this._rendermime.render(bundle);
    this._tooltip.show();

    let tooltip = this._tooltip.node;
    let { width, height } = tooltip.getBoundingClientRect();
    let maxWidth: number;
    let maxHeight: number;
    let { top, bottom, left } = change.coords;
    let border = parseInt(window.getComputedStyle(tooltip).borderWidth, 10);
    let heightAbove = top + border;
    let heightBelow = window.innerHeight - bottom - border;
    let widthLeft = left;
    let widthRight = window.innerWidth - left;

    // Prefer displaying below.
    if (heightBelow >= height || heightBelow >= heightAbove) {
      // Offset the height of the tooltip by the height of cursor characters.
      top += change.chHeight;
      maxHeight = heightBelow;
    } else {
      maxHeight = heightAbove;
      top -= Math.min(height, maxHeight);
    }

    // Prefer displaying on the right.
    if (widthRight >= width || widthRight >= widthLeft) {
      left += border;
      maxWidth = widthRight;
    } else {
      maxWidth = widthLeft;
      left -= Math.min(width, maxWidth);
    }

    tooltip.style.top = `${Math.floor(top)}px`;
    tooltip.style.left = `${Math.floor(left)}px`;
    tooltip.style.maxHeight = `${Math.floor(maxHeight)}px`;
    tooltip.style.maxWidth = `${Math.floor(maxWidth)}px`;
  }

  /**
   * Update the tooltip based on a text change.
   */
  protected updateTooltip(change: ITextChange): void {
    let contents: KernelMessage.IInspectRequest = {
      code: change.newValue,
      cursor_pos: change.position,
      detail_level: 0
    };
    let pendingInspect = ++this._pendingInspect;

    this._session.kernel.inspect(contents).then(msg => {
      let value = msg.content;
      // If widget has been disposed, bail.
      if (this.isDisposed) {
        return;
      }
      // If a newer text change has created a pending request, bail.
      if (pendingInspect !== this._pendingInspect) {
        return;
      }
      // Tooltip request failures or negative results fail silently.
      if (value.status !== 'ok' || !value.found) {
        return;
      }
      this.showTooltip(change, value.data as MimeMap<string>);
    });
  }

  private _completion: CompletionWidget = null;
  private _completionHandler: CellCompletionHandler = null;
  private _mimetype = 'text/x-ipython';
  private _rendermime: RenderMime<Widget> = null;
  private _renderer: ConsoleWidget.IRenderer = null;
  private _tooltip: ConsoleTooltip = null;
  private _history: IConsoleHistory = null;
  private _session: ISession = null;
  private _pendingInspect = 0;
}

/**
 * A namespace for ConsoleWidget statics.
 */
export
namespace ConsoleWidget {
  /**
   * The initialization options for a console widget.
   */
  export
  interface IOptions {
    /**
     * The completion widget for a console widget.
     */
    completion?: CompletionWidget;

    /**
     * The mime renderer for the console widget.
     */
    rendermime: RenderMime<Widget>;

    /**
     * The renderer for a console widget.
     */
    renderer?: IRenderer;

    /**
     * The session for the console widget.
     */
    session: ISession;

    /**
     * The tooltip widget for a console widget.
     */
    tooltip?: ConsoleTooltip;
  }

  /**
   * A renderer for completion widget nodes.
   */
  export
  interface IRenderer {
    /**
     * Create a new banner widget.
     */
    createBanner(): RawCellWidget;

    /**
     * Create a new prompt widget.
     */
    createPrompt(rendermime: RenderMime<Widget>): CodeCellWidget;
  }


  /**
   * The default implementation of an `IRenderer`.
   */
  export
  class Renderer implements IRenderer {
    /**
     * Create a new banner widget.
     */
    createBanner(): RawCellWidget {
      let widget = new RawCellWidget();
      widget.model = new RawCellModel();
      return widget;
    }

    /**
     * Create a new prompt widget.
     */
    createPrompt(rendermime: RenderMime<Widget>): CodeCellWidget {
      let widget = new CodeCellWidget({ rendermime });
      widget.model = new CodeCellModel();
      return widget;
    }
  }


  /**
   * The default `IRenderer` instance.
   */
  export
  const defaultRenderer = new Renderer();
}


/**
 * A namespace for console widget private data.
 */
namespace Private {
  /**
   * Scroll an element into view if needed.
   *
   * @param area - The scroll area element.
   *
   * @param elem - The element of interest.
   */
  export
  function scrollIfNeeded(area: HTMLElement, elem: HTMLElement): void {
    let ar = area.getBoundingClientRect();
    let er = elem.getBoundingClientRect();
    if (er.top < ar.top - 10) {
      area.scrollTop -= ar.top - er.top + 10;
    } else if (er.bottom > ar.bottom + 10) {
      area.scrollTop += er.bottom - ar.bottom + 10;
    }
  }

  /**
   * Jump to the bottom of a node.
   *
   * @param node - The scrollable element.
   */
  export
  function scrollToBottom(node: HTMLElement): void {
    node.scrollTop = node.scrollHeight;
  }
}
