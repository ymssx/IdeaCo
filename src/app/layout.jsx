import './globals.css';

export const metadata = {
  title: 'AI Enterprise - AI企业管理系统',
  description: '招聘AI Agent组建部门协作完成真实项目',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
