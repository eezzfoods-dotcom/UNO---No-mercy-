// Mount point for the whole game. Drop this into the Semma app's game router:
//
//   import UnoGame from './games/uno-no-mercy/UnoGame';
//   <UnoGame onExit={() => setGame(null)} />
//
// Pass `socket` to reuse the app's existing socket.io connection instead of
// opening a second one.

import { UnoProvider, useUno } from './context/UnoContext';
import { Toast } from './components/ui';
import Home from './screens/Home';
import Lobby from './screens/Lobby';
import Table from './screens/Table';
import Over from './screens/Over';

function Router({ onExit }) {
  const { screen, error, setError } = useUno();
  return (
    <>
      <Toast text={error} onDone={() => setError('')} />
      {screen === 'home'  && <Home onExit={onExit} />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'table' && <Table />}
      {screen === 'over'  && <Over />}
    </>
  );
}

export default function UnoGame({ onExit, socket, url }) {
  return (
    <UnoProvider socket={socket} url={url}>
      <Router onExit={onExit} />
    </UnoProvider>
  );
}
