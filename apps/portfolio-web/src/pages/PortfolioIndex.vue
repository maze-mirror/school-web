<template>
  <main class="portfolio-index">
    <div>
      <p class="eyebrow">PERSONAL WEBSITES</p>
      <h1>Sailing Log</h1>
      <p>A voyage through characters, ocean and curiosity.</p>
      <a
        href="https://github.com/maze-mirror/portfolio_sailingLog"
        target="_blank"
        rel="noopener noreferrer"
        >View repository ↗</a
      >
    </div>
  </main>
</template>

<style scoped>
.portfolio-index {
  min-height: 100dvh;
  display: grid;
  align-items: center;
  padding: 8%;
  color: #184d97;
  font-family: 'Courier New', monospace;
  line-height: 1.8;
}
.eyebrow {
  font-size: 12px;
  letter-spacing: 0.12em;
}
h1 {
  margin: 0;
  font-family: Georgia, serif;
  font-style: italic;
  font-size: clamp(40px, 7vw, 80px);
  font-weight: 400;
}
a {
  display: inline-block;
  margin-top: 20px;
  color: inherit;
  text-underline-offset: 5px;
}
</style>
