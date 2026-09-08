(function () {
  var work = document.getElementById('work');
  if (!work) return;
  var filters = work.querySelector('.work-filters');
  if (!filters) return;
  var buttons = filters.querySelectorAll('[data-work-filter]');
  var items = work.querySelectorAll('.work-item[data-categories]');
  var empty = work.querySelector('.work-empty');
  var status = work.querySelector('.work-filter-status');

  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      var category = button.dataset.workFilter;
      var count = 0;
      buttons.forEach(function (other) {
        other.setAttribute('aria-pressed', String(other === button));
      });
      items.forEach(function (item) {
        var visible = category === 'all' || item.dataset.categories.split(/\s+/).includes(category);
        var wasHidden = item.hidden;
        item.hidden = !visible;
        if (visible) count += 1;
        item.querySelectorAll('video').forEach(function (video) {
          if (!visible) video.pause();
          else if (wasHidden && video.autoplay) video.play().catch(function () {});
        });
        // Re-measure restored carousels, including after resizing while hidden.
        if (visible) item.querySelectorAll('[data-carousel]').forEach(function (carousel) {
          carousel.dispatchEvent(new Event('work:shown'));
        });
      });
      empty.hidden = count > 0;
      status.textContent = button.textContent + '：' + count + ' 个项目';
    });
  });
  filters.hidden = false;
})();
