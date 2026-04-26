import { Route, Routes } from "react-router";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<h1>Hello pika</h1>} />
    </Routes>
  );
}
