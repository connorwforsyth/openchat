// Tests don't load the Tailwind theme, so popups lose the `fixed` and `z-50`
// (and the placement) that lift them above Base UI's modal backdrop, and the backdrop takes
// their clicks. This gives them just that stacking; nothing else is styled.
const style = document.createElement("style");
style.textContent = `
  [data-slot$="-content"][role="dialog"],
  [data-slot$="-content"][role="alertdialog"],
  [data-slot="dropdown-menu-content"],
  [data-slot="select-content"] {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 50;
  }
`;
document.head.append(style);
