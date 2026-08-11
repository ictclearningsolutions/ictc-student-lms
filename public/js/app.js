(function () {
  var alerts = document.querySelectorAll('.alert');
  alerts.forEach(function (a) {
    setTimeout(function () {
      a.style.transition = 'opacity 0.4s';
      a.style.opacity = '0';
      setTimeout(function () { a.remove(); }, 400);
    }, 5000);
  });
})();
