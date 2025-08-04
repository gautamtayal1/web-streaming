import Link from 'next/link'
import React from 'react'

const Home = () => {
  return (
    <div>
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900">
        <div className="flex space-x-8">
          <Link href="/watch">
            <button className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white text-2xl rounded-xl shadow-lg hover:scale-105 hover:from-blue-600 hover:to-purple-700 transition-all duration-200">
              Watch
            </button>
          </Link>
          <Link href="/stream">
            <button className="px-8 py-4 bg-gradient-to-r from-green-500 to-teal-600 text-white text-2xl rounded-xl shadow-lg hover:scale-105 hover:from-green-600 hover:to-teal-700 transition-all duration-200">
              Stream
            </button>
          </Link>
        </div>
      </div>
    </div>
  )
}

export default Home