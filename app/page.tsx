import LabyrinthGame from "@/components/LabyrinthGame";

export default function Home() {
  return (
    <div
      className="labyrinth-page-root"
      style={{
        width: "100%",
        maxWidth: "100%",
        minHeight: "100dvh",
        background: "#0f0f14",
        overflowX: "hidden",
      }}
    >
      <LabyrinthGame />
    </div>
  );
}
