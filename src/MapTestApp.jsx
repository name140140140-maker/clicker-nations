import WorldMapGL from "./WorldMapGL";

export default function MapTestApp() {
  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>CLICKER NATIONS</p>
          <h1 style={styles.title}>MapLibre test area</h1>
        </div>
        <span style={styles.status}>Map renderer online</span>
      </header>
      <section style={styles.mapFrame} aria-label="Interactive MapLibre map">
        <WorldMapGL />
      </section>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    gap: 16,
    padding: 16,
    boxSizing: "border-box",
    background: "#101820",
    color: "#f4f7f8",
    fontFamily: "Georgia, serif",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "8px 4px",
  },
  eyebrow: {
    margin: 0,
    color: "#63d6c6",
    fontFamily: "Arial, sans-serif",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.16em",
  },
  title: {
    margin: "6px 0 0",
    fontSize: "clamp(24px, 4vw, 42px)",
    fontWeight: 500,
  },
  status: {
    border: "1px solid #315760",
    borderRadius: 999,
    padding: "8px 12px",
    color: "#9de9df",
    fontFamily: "Arial, sans-serif",
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  mapFrame: {
    minHeight: 420,
    overflow: "hidden",
    border: "1px solid #315760",
    borderRadius: 14,
    background: "#17242b",
  },
};
