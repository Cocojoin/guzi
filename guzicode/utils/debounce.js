function debounce(fn, delay = 800) {
  let coolingDown = false;
  let releaseTimer = null;

  return function (...args) {
    if (coolingDown) {
      return;
    }

    coolingDown = true;
    fn.apply(this, args);

    if (releaseTimer) {
      clearTimeout(releaseTimer);
    }

    releaseTimer = setTimeout(() => {
      coolingDown = false;
      releaseTimer = null;
    }, delay);
  };
}

module.exports = {
  debounce
};
