try {
  if (JSON.parse(localStorage.getItem('day-planner-darkmode'))) {
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#1f2937');
    document.documentElement.style.backgroundColor = '#1f2937';
    document.documentElement.classList.add('dark');
  }
} catch(e) {}
