// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
var Widget = require('@phosphor/widgets').Widget;
var countCall = require('./util');

countCall('@jupyterlab/python-tests loaded');


module.exports.default = {
  id: 'mockextension',
  autoStart: true,
  activate: function(application) {
    countCall('@jupyterlab/python-tests activated');
    var w = new Widget();
    w.title.label = 'Python Tests';
    w.id = 'id-jupyterlab-python-tests';
    application.shell.addToRightArea(w);
  }
};
