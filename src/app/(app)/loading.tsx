export default function Loading() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6" aria-busy="true">
      <p role="status" className="text-sm text-muted">กำลังโหลดข้อมูล...</p>
    </main>
  );
}
