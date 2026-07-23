const navToggle = document.querySelector(".nav-toggle");
const navigation = document.querySelector(".primary-nav");
const navigationLinks = [...document.querySelectorAll(".primary-nav a")];
const themeToggles = [...document.querySelectorAll(".theme-toggle")];

function syncThemeControls() {
  const isLight = document.documentElement.dataset.theme === "light";
  themeToggles.forEach((button) => {
    button.querySelector("span").textContent = isLight ? "☾" : "☀";
    button.querySelector("b").textContent = isLight ? "Dark skin" : "Light skin";
    button.setAttribute("aria-label", `Switch to ${isLight ? "dark" : "light"} skin`);
    button.setAttribute("aria-pressed", String(isLight));
  });
}

themeToggles.forEach((button) => {
  button.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("apprime-theme", nextTheme);
    syncThemeControls();
  });
});

syncThemeControls();

navToggle?.addEventListener("click", () => {
  const isOpen = navigation.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

navigationLinks.forEach((link) => {
  link.addEventListener("click", () => {
    navigationLinks.forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
    navigation.classList.remove("open");
    navToggle?.setAttribute("aria-expanded", "false");
  });
});

const observedSections = [...document.querySelectorAll("main [id]")];
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const activeLink = navigationLinks.find(
        (link) => link.getAttribute("href") === `#${visible.target.id}`
      );
      if (!activeLink) return;
      navigationLinks.forEach((link) => link.classList.toggle("active", link === activeLink));
    },
    { rootMargin: "-20% 0px -65% 0px", threshold: [0.05, 0.25, 0.5] }
  );
  observedSections.forEach((section) => observer.observe(section));
}
