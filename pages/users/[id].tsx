import { GetServerSideProps } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authClient } from "@/lib/auth-client";

interface UserDetailProps {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    emailVerified: boolean;
    createdAt: string;
    lastActivityAt: string | null;
  };
  orgName: string;
  currentUserEmail: string;
  isCurrentUser: boolean;
}

export const getServerSideProps: GetServerSideProps<UserDetailProps> = async (context) => {
  const { id } = context.params as { id: string };

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

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { org: true },
  });

  if (!currentUser || !currentUser.org) {
    return {
      redirect: {
        destination: "/login",
        permanent: false,
      },
    };
  }

  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user || user.orgId !== currentUser.orgId) {
    return {
      notFound: true,
    };
  }

  return {
    props: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt.toISOString(),
        lastActivityAt: user.lastActivityAt?.toISOString() || null,
      },
      orgName: currentUser.org.name,
      currentUserEmail: currentUser.email,
      isCurrentUser: user.id === currentUser.id,
    },
  };
};

export default function UserDetailPage({
  user,
  orgName,
  currentUserEmail,
  isCurrentUser,
}: UserDetailProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/login");
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${user.name}?`)) {
      return;
    }

    setDeleting(true);
    setError("");

    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete user");
        setDeleting(false);
        return;
      }

      router.push("/users");
    } catch (err) {
      setError("An error occurred");
      setDeleting(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/users" className="text-gray-600 hover:text-gray-900">
              ← Users
            </Link>
            <h1 className="text-xl font-semibold text-gray-900">{orgName}</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{currentUserEmail}</span>
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
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">
              {error}
            </div>
          )}

          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{user.name}</h2>
              <p className="text-gray-600">{user.email}</p>
            </div>
            <span
              className={`inline-flex px-3 py-1 text-sm font-medium rounded-full ${
                user.role === "admin"
                  ? "bg-purple-100 text-purple-800"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {user.role}
            </span>
          </div>

          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <dt className="text-sm font-medium text-gray-500">Email Verified</dt>
              <dd className="mt-1 text-gray-900">
                {user.emailVerified ? (
                  <span className="text-green-600">Yes</span>
                ) : (
                  <span className="text-gray-400">No</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Created</dt>
              <dd className="mt-1 text-gray-900">{formatDate(user.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Last Activity</dt>
              <dd className="mt-1 text-gray-900">
                {user.lastActivityAt ? formatDate(user.lastActivityAt) : "Never"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">User ID</dt>
              <dd className="mt-1 text-gray-500 text-sm font-mono">{user.id}</dd>
            </div>
          </dl>

          {!isCurrentUser && (
            <div className="pt-4 border-t">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete User"}
              </button>
            </div>
          )}

          {isCurrentUser && (
            <p className="pt-4 border-t text-sm text-gray-500">
              This is your account. You cannot delete yourself.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
