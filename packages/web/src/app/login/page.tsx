import { signIn } from "@/lib/auth";

export default function LoginPage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: "1rem",
      }}
    >
      <h1>Pika</h1>
      <p>Replay and search coding agent sessions</p>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/dashboard" });
        }}
      >
        <button type="submit">Sign in with Google</button>
      </form>
    </div>
  );
}
