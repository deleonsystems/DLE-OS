(function registerDleWorkbenchShell(window, document) {
  "use strict";

  let activeWorkbenchId = "";
  let activeContext = null;
  let activeWorkspaceState = null;

  function getCurrentWorkspaceId(context) {
    return context.sourceWorkspaceId
      || window.DleWorkspaceShell?.getCurrentWorkspace?.()?.id
      || "";
  }

  function getWorkspaceMount(workspaceId) {
    if (!workspaceId) return null;
    return document.querySelector(`[data-workspace-mount="${workspaceId}"]`);
  }

  function getWorkbenchMount(workbenchId) {
    if (!workbenchId) return null;
    return document.querySelector(`[data-workbench-mount="${workbenchId}"]`);
  }

  function open(workbenchId, context = {}) {
    const workbench = window.DleWorkbenches?.[workbenchId];
    if (!workbench?.render) {
      console.warn("DLE-OS Workbench is not registered.", workbenchId);
      return null;
    }

    if (activeWorkbenchId && activeWorkbenchId !== workbenchId) {
      close(activeWorkbenchId);
    }

    const sourceWorkspaceId = getCurrentWorkspaceId(context);
    const workspaceMount = getWorkspaceMount(sourceWorkspaceId);
    const workbenchMount = getWorkbenchMount(workbenchId);

    activeWorkspaceState = {
      workspaceId: sourceWorkspaceId,
      scrollY: window.scrollY || document.documentElement.scrollTop || 0
    };

    if (workspaceMount) workspaceMount.hidden = true;
    if (workbenchMount) workbenchMount.hidden = false;

    activeWorkbenchId = workbenchId;
    activeContext = {
      ...context,
      sourceWorkspaceId
    };

    document.body.dataset.workbench = workbenchId;
    document.body.dataset.operatingEnvironment = "workbench";
    document.dispatchEvent(new CustomEvent("dle:workbench-open", {
      detail: { workbenchId, context: activeContext }
    }));

    Promise.resolve(workbench.render(activeContext)).catch(error => {
      console.error("Unable to render DLE-OS workbench.", error);
      close(workbenchId);
    });

    return { workbenchId, context: activeContext };
  }

  function close(workbenchId = activeWorkbenchId) {
    const workbench = window.DleWorkbenches?.[workbenchId];
    if (workbench?.close) workbench.close();

    const sourceWorkspaceId = activeWorkspaceState?.workspaceId || activeContext?.sourceWorkspaceId || "";
    const workspaceMount = getWorkspaceMount(sourceWorkspaceId);
    const workbenchMount = getWorkbenchMount(workbenchId);
    const restoreScrollY = activeWorkspaceState?.scrollY || 0;

    if (workbenchMount) workbenchMount.hidden = true;
    if (workspaceMount) workspaceMount.hidden = false;

    activeWorkbenchId = "";
    activeContext = null;
    activeWorkspaceState = null;
    delete document.body.dataset.workbench;
    document.body.dataset.operatingEnvironment = "workspace";

    document.dispatchEvent(new CustomEvent("dle:workbench-close", {
      detail: { workbenchId }
    }));

    requestAnimationFrame(() => {
      window.scrollTo({ top: restoreScrollY, behavior: "auto" });
    });
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
