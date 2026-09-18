import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <section>
      <h1>Not found</h1>
      <p>That page does not exist yet.</p>
      <p>
        <Link to="/">Back to home</Link>
      </p>
    </section>
  );
}
