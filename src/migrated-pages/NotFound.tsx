import { useLocation } from "@/features/frontend-migration/router";
import { useEffect } from "react";
import Link from "next/link";

const NotFound = () => {
    const location = useLocation();

    useEffect(() => {
        console.error(
            "404 Error: User attempted to access non-existent route:",
            location.pathname
        );
    }, [location.pathname]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-white">
            <div className="text-center">
                <img
                    src="https://b.ux-cdn.com/superun/notfound.jpeg"
                    alt="404"
                    className="mx-auto w-60 mb-2 object-contain opacity-80"
                />
                <p className="text-3xl font-bold mb-4 text-gray-700">页面待开发</p>
                <Link href="/" className="text-blue-500 hover:text-blue-700 underline">
                    返回首页
                </Link>
            </div>
        </div>
    );
};

export default NotFound;
