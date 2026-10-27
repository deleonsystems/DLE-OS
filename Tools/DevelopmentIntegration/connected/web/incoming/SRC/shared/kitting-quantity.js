(function registerKittingQuantity(window) {
  'use strict';
  const compact = new Intl.NumberFormat('en-US', { useGrouping: false, maximumSignificantDigits: 12 });
  function format(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value ?? '').trim() || '\u2014';
    if (number === 0) return '0';
    // Preserve small nonzero requirements; this is display rounding only.
    return Math.abs(number) < 0.000001
      ? Number(number.toPrecision(12)).toString()
      : compact.format(number);
  }
  window.KittingQuantity = Object.freeze({ format });
})(window);
