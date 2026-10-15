// Settings own their draft; every voluntary shell navigation asks before discarding it.
export function settingsNavigationAllowed() {
  return window.dispatchEvent(new Event('zhijun-before-navigation', {cancelable:true}));
}
