type AppNavProps = {
  currentPath?: '/';
};

export function AppNav({ currentPath: _currentPath = '/' }: AppNavProps) {
  return (
    <header className="header header--simple">
      <a className="brand brand-link" href="/" aria-label="픽셀 월드 홈">
        <strong>픽셀 월드</strong>
        <span>친구 방 만들기</span>
      </a>
    </header>
  );
}
