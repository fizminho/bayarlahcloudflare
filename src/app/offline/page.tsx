'use client'

export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-gray-200 flex items-center justify-center px-6">
      <section className="w-full max-w-sm bg-white p-8 text-center shadow-xl">
        <div className="text-3xl font-bold tracking-widest">BayarLah</div>
        <div className="my-5 border-t border-dashed border-gray-300" />
        <h1 className="text-lg font-bold">You’re offline</h1>
        <p className="mt-2 text-sm text-gray-500">
          Connect to the internet to create, open or update a shared receipt.
          Your receipt data is not stored for offline access on this device.
        </p>
        <button onClick={() => window.location.reload()} className="mt-6 w-full bg-black px-5 py-3 text-sm text-white">
          TRY AGAIN
        </button>
      </section>
    </main>
  )
}
