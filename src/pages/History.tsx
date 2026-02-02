import TaskHistory from '../components/history/TaskHistory';
import Header from '../components/layout/Header';

export default function HistoryPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="mb-6 font-semibold text-2xl text-text">Task History</h1>
        <TaskHistory showTitle={false} />
      </main>
    </div>
  );
}
