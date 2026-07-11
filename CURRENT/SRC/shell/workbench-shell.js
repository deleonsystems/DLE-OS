(function registerDleWorkbenchShell(window, document) {
  "use strict";

  let activeWorkbenchId = "";
  let activeContext = null;

  function open(workbenchId, context = {}) {
    const workbench = window.DleWorkbenches?.[workbenchId];
    if (!workbench?.render) {
      console.warn("DLE-OS Workbench is not registered.", workbenchId);
      return null;
    }

    activeWorkbenchId = workbenchId;
    activeContext = context;

    document.body.dataset.workbench = workbenchId;
    document.dispatchEvent(new CustomEvent("dle:workbench-open", {
      detail: { workbenchId, context }
    }));

    Promise.resolve(workbench.render(context)).catch(error => {
      console.error("Unable to render DLE-OS workbench.", error);
    });

    return { workbenchId, context };
  }

  function close(workbenchId = activeWorkbenchId) {
    const workbench = window.DleWorkbenches?.[workbenchId];
    if (workbench?.close) workbench.close();

    activeWorkbenchId = "";
    activeContext = null;
    delete document.body.dataset.workbench;

    document.dispatchEvent(new CustomEvent("dle:workbench-close", {
      detail: { workbenchId }
    }));
  }

  function getCurrent() {
    return {
      workbenchId: activeWorkbenchId,
      context: activeContext
    };
  }

  window.DleWorkbenchShell = Object.freeze({
    open,
    close,
    getCurrent
  });
})(window, document);
