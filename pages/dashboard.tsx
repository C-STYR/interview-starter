import { GetServerSideProps } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authClient } from "@/lib/auth-client";

interface DashboardProps {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  org: {
    id: string;
    name: string;
  };
  userCount: number;
}

export const getServerSideProps: GetServerSideProps<DashboardProps> = async (context) => {
  const session = await auth.api.getSession({
    headers: new Headers(context.req.headers as Record<string, string>),
  });

  if (!session) {
    return {
      redirect: {
        destination: "/login",
        permanent: false,
      },
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { org: true },
  });

  if (!user || !user.org) {
    return {
      redirect: {
        destination: "/login",
        permanent: false,
      },
    };
  }

  const userCount = await prisma.user.count({
    where: { orgId: user.orgId },
  });

  return {
    props: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      org: {
        id: user.org.id,
        name: user.org.name,
      },
      userCount,
    },
  };
};

export default function DashboardPage({ user, org, userCount }: DashboardProps) {
  const router = useRouter();

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-semibold text-gray-900">{org.name}</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user.email}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Welcome, {user.name}!
          </h2>
          <p className="text-gray-600 mb-6">
            You are logged in as <span className="font-medium">{user.role}</span> at {org.name}.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-blue-50 rounded-lg p-4">
              <p className="text-3xl font-bold text-blue-600">{userCount}</p>
              <p className="text-sm text-blue-800">Users in your organization</p>
            </div>
          </div>

          <div className="mt-6">
            <Link
              href="/users"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Manage Users
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
