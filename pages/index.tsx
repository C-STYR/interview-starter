import { GetServerSideProps } from "next";
import { auth } from "@/lib/auth";

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await auth.api.getSession({
    headers: new Headers(context.req.headers as Record<string, string>),
  });

  if (session) {
    return {
      redirect: {
        destination: "/dashboard",
        permanent: false,
      },
    };
  }

  return {
    redirect: {
      destination: "/login",
      permanent: false,
    },
  };
};

export default function Home() {
  return null;
}
