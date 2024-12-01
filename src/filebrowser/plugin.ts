// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  ServiceManager
} from 'jupyter-js-services';

import {
  IWidgetOpener, FileBrowserWidget
} from './browser';

import {
  FileBrowserModel
} from './model';

import {
  DocumentManager
} from '../docmanager';

import {
  DocumentRegistry
} from '../docregistry';

import {
  Application
} from 'phosphide/lib/core/application';

import {
  Menu, MenuItem, IMenuItemOptions, MenuItemType
} from 'phosphor-menus';

import {
  IChangedArgs
} from 'phosphor-properties';

import {
  ISignal, Signal
} from 'phosphor-signaling';

import {
  Widget
} from 'phosphor-widget';

import {
  WidgetTracker
} from '../widgettracker';

import {
  MainMenu, mainMenuProvider
} from '../mainmenu/plugin';


/**
 * A class that tracks the current path of the file browser.
 */
export
class PathTracker {
  /**
   * A signal emitted when the current path changes.
   */
  get pathChanged(): ISignal<PathTracker, IChangedArgs<string>> {
    return Private.pathChangedSignal.bind(this);
  }

  /**
   * The current path of the filebrowser.
   *
   * #### Notes
   * This is a read-only property.
   */
  get path(): string {
    return Private.fbWidget ? Private.fbWidget.model.path : '';
  }
}


/**
 * The default file browser provider.
 */
export
const fileBrowserProvider = {
  id: 'jupyter.services.fileBrowser',
  provides: PathTracker,
  resolve: () => {
    return Private.pathTracker;
  }
};


/**
 * The default file browser extension.
 */
export
const fileBrowserExtension = {
  id: 'jupyter.extensions.fileBrowser',
  requires: [ServiceManager, DocumentRegistry, MainMenu],
  activate: activateFileBrowser
};


/**
 * The class name for all main area portrait tab icons.
 */
const PORTRAIT_ICON_CLASS = 'jp-MainAreaPortraitIcon';

/**
 * The class name for the notebook icon from the default theme.
 */
const NOTEBOOK_ICON_CLASS = 'jp-ImageNotebook';

/**
 * The class name for the text editor icon from the default theme.
 */
const TEXTEDITOR_ICON_CLASS = 'jp-ImageTextEditor';


/**
 * Activate the file browser.
 */
function activateFileBrowser(app: Application, manager: ServiceManager, registry: DocumentRegistry, mainMenu: MainMenu): Promise<void> {
  let id = 0;

  let tracker = new WidgetTracker<Widget>();
  let activeWidget: Widget;
  tracker.activeWidgetChanged.connect((sender, widget) => {
    activeWidget = widget;
  });

  let opener: IWidgetOpener = {
    open: (widget) => {
      if (!widget.id) {
        widget.id = `document-manager-${++id}`;
      }
      if (!widget.isAttached) {
        app.shell.addToMainArea(widget);
        tracker.addWidget(widget);
      }
    }
  };

  let docManager = new DocumentManager({
    registry,
    manager,
    opener
  });
  let fbModel = new FileBrowserModel({ manager });
  let fbWidget = Private.fbWidget = new FileBrowserWidget({
    model: fbModel,
    manager: docManager,
    opener
  });

  fbModel.pathChanged.connect((sender, args) => {
    Private.pathTracker.pathChanged.emit(args);
  });

  // Add a context menu to the dir listing.
  let node = fbWidget.node.getElementsByClassName('jp-DirListing-content')[0];
  node.addEventListener('contextmenu', (event: MouseEvent) => {
    event.preventDefault();
    let x = event.clientX;
    let y = event.clientY;
    let path = fbWidget.pathForClick(event);
    let ext = '.' + path.split('.').pop();
    let widgetNames = registry.listWidgetFactories(ext);
    let items: MenuItem[] = [];
    if (widgetNames.length > 1) {
      for (let widgetName of widgetNames) {
        items.push(new MenuItem({
          text: widgetName,
          handler: () => {
            fbWidget.openPath(path, widgetName);
          }
        }));
      }
    }
    let menu = createMenu(fbWidget, items);
    menu.popup(x, y);
  });

  // Add the command for a new items.
  let newTextFileId = 'file-operations:new-text-file';

  app.commands.add([
    {
      id: newTextFileId,
      handler: () => {
        let icon = `${PORTRAIT_ICON_CLASS} ${TEXTEDITOR_ICON_CLASS}`;
        fbWidget.createNew({ type: 'file' }).then(widget => widget.title.icon = icon);
      }
    }
  ]);

  let newNotebookId = 'file-operations:new-notebook';

  app.commands.add([
    {
      id: newNotebookId,
      handler: () => {
        let icon = `${PORTRAIT_ICON_CLASS} ${NOTEBOOK_ICON_CLASS}`;
        fbWidget.createNew({ type: 'notebook' }).then(widget => {
          widget.title.icon = icon;
        });
      }
    }
  ]);


  // Add the command for saving a document.
  let saveDocumentId = 'file-operations:save';

  app.commands.add([
    {
      id: saveDocumentId,
      handler: () => {
        if (activeWidget) {
          let context = docManager.contextForWidget(activeWidget);
          context.save();
        }
      }
    }
  ]);
  app.palette.add([
    {
      command: saveDocumentId,
      category: 'File Operations',
      text: 'Save Document',
      caption: 'Save the current document'
    }
  ]);

  // Add the command for reverting a document.
  let revertDocumentId = 'file-operations:revert';

  app.commands.add([
    {
      id: revertDocumentId,
      handler: () => {
        if (activeWidget) {
          let context = docManager.contextForWidget(activeWidget);
          context.revert();
        }
      }
    }
  ]);
  app.palette.add([
    {
      command: revertDocumentId,
      category: 'File Operations',
      text: 'Revert Document',
      caption: 'Revert the current document'
    }
  ]);

  // Add the command for closing a document.
  let closeDocumentId = 'file-operations:close';

  app.commands.add([
    {
      id: closeDocumentId,
      handler: () => {
        if (activeWidget) {
          activeWidget.close();
        }
      }
    }
  ]);
  app.palette.add([
    {
      command: closeDocumentId,
      category: 'File Operations',
      text: 'Close Document',
      caption: 'Close the current document'
    }
  ]);

  // Add the command for closing all documents.
  let closeAllId = 'file-operations:close-all';

  app.commands.add([
    {
      id: closeAllId,
      handler: () => {
        docManager.closeAll();
      }
    }
  ]);
  app.palette.add([
    {
      command: closeAllId,
      category: 'File Operations',
      text: 'Close All',
      caption: 'Close all open documents'
    }
  ]);

  app.palette.add([
    {
      command: newTextFileId,
      category: 'File Operations',
      text: 'New Text File',
      caption: 'Create a new text file'
    },
    {
      command: newNotebookId,
      category: 'File Operations',
      text: 'New Notebook',
      caption: 'Create a new notebook'
    }
  ]);

  app.commands.add([
    {
      id: 'file-browser:activate',
      handler: showBrowser
    },
    {
      id: 'file-browser:hide',
      handler: hideBrowser
    },
    {
      id: 'file-browser:toggle',
      handler: toggleBrowser
    }
  ]);

  fbWidget.title.text = 'Files';
  fbWidget.id = 'file-browser';
  app.shell.addToLeftArea(fbWidget, { rank: 40 });
  showBrowser();



    // Adding Top Menu
      let newSubMenu = new Menu ([
        new MenuItem({
          text: 'Notebook',
          handler: () => {
            app.commands.execute(newNotebookId);
          }
        }),
        new MenuItem({
          text: 'Text File',
          handler: () => {
            app.commands.execute(newTextFileId);
          }
        })

      ]);



      let menu = new Menu ([
        new MenuItem({
          text: 'New',
          submenu: newSubMenu

        }),
        new MenuItem({
          text: 'Save Document',
          handler: () => {
            app.commands.execute(saveDocumentId);
          }
        }),
        new MenuItem({
          text: 'Revert Document',
          handler: () => {
            app.commands.execute(revertDocumentId);
          }
        }),
        new MenuItem({
          text: 'Close Current',
          handler: () => {
            app.commands.execute(closeDocumentId);
          }
        }),
        new MenuItem({
          text: 'Close All',
          handler: () => {
            app.commands.execute(closeAllId);
          }
        }),

      ]);

      let fileMenu = new MenuItem({
        text: 'File',
        submenu: menu
      });
      mainMenu.addItem(fileMenu, {rank: 1});


  return Promise.resolve(void 0);

  function showBrowser(): void {
    app.shell.activateLeft(fbWidget.id);
  }

  function hideBrowser(): void {
    if (!fbWidget.isHidden) {
      app.shell.collapseLeft();
    }
  }

  function toggleBrowser(): void {
    if (fbWidget.isHidden) {
      showBrowser();
    } else {
      hideBrowser();
    }
  }

}


/**
 * Create a context menu for the file browser listing.
 */
function createMenu(fbWidget: FileBrowserWidget, openWith: MenuItem[]):  Menu {
  let items = [
    new MenuItem({
      text: '&Open',
      icon: 'fa fa-folder-open-o',
      shortcut: 'Ctrl+O',
      handler: () => { fbWidget.open(); }
    })
  ];
  if (openWith.length) {
    items.push(new MenuItem({
      text: 'Open With...',
      submenu: new Menu(openWith)
    }));
  }
  items.push(
    new MenuItem({
      text: '&Rename',
      icon: 'fa fa-edit',
      shortcut: 'Ctrl+R',
      handler: () => { fbWidget.rename(); }
    }),
    new MenuItem({
      text: '&Delete',
      icon: 'fa fa-remove',
      shortcut: 'Ctrl+D',
      handler: () => { fbWidget.delete(); }
    }),
    new MenuItem({
      text: 'Duplicate',
      icon: 'fa fa-copy',
      handler: () => { fbWidget.duplicate(); }
    }),
    new MenuItem({
      text: 'Cut',
      icon: 'fa fa-cut',
      shortcut: 'Ctrl+X',
      handler: () => { fbWidget.cut(); }
    }),
    new MenuItem({
      text: '&Copy',
      icon: 'fa fa-copy',
      shortcut: 'Ctrl+C',
      handler: () => { fbWidget.copy(); }
    }),
    new MenuItem({
      text: '&Paste',
      icon: 'fa fa-paste',
      shortcut: 'Ctrl+V',
      handler: () => { fbWidget.paste(); }
    }),
    new MenuItem({
      text: 'Download',
      icon: 'fa fa-download',
      handler: () => { fbWidget.download(); }
    }),
    new MenuItem({
      text: 'Shutdown Kernel',
      icon: 'fa fa-stop-circle-o',
      handler: () => { fbWidget.shutdownKernels(); }
    })
  );
  return new Menu(items);
}


/**
 * A namespace for private data.
 */
namespace Private {
  export
  var fbWidget: FileBrowserWidget;

  export
  const pathTracker = new PathTracker();

  /**
   * A signal emitted when the current working directory changes.
   */
  export
  const pathChangedSignal = new Signal<PathTracker, IChangedArgs<string>>();
}
