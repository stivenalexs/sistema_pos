import Link from "next/link";

// Temporary home page. The catalog arrives in plan step 9.
export default function Home() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Bienvenido</h1>
      <p>El catálogo estará disponible pronto.</p>
      <p>
        <Link href="/signup" className="underline">
          Crea tu cuenta
        </Link>{" "}
        para comprar.
      </p>
    </section>
  );
}
