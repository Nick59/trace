// Which keyboard directions currently lead somewhere; the step page writes it, StepNav and the layout footer read it. overlay/canGo describe the completion overlay for the footer legend.
export const navHints = $state({ up: false, down: false, left: false, right: false, overlay: false, canGo: false });
