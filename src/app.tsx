import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { BackgroundRemover } from './components/BackgroundRemover';
import { PhotoEditor } from './components/PhotoEditor';
import { QRGenerator } from './components/QRGenerator';

// Main App component with router
function App(): React.JSX.Element {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<BackgroundRemover />} />
          <Route path="/photo-editor" element={<PhotoEditor />} />
          <Route path="/qr-generator" element={<QRGenerator />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
