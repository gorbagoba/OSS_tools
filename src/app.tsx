import React from 'react';
import {
  BrowserRouter as Router, Routes, Route, Navigate,
} from 'react-router-dom';
import { Layout } from './components/Layout';
import { BackgroundRemover } from './components/BackgroundRemover';
import { PhotoEditor } from './components/PhotoEditor';
import { QRGenerator } from './components/QRGenerator';
import { ConvertToMarkdown } from './components/ConvertToMarkdown';
import { PDFToolkit } from './components/PDFToolkit';
import { ImageCompressor } from './components/ImageCompressor';
import { HeicConverter } from './components/HeicConverter';

// Main App component with router
function App(): React.JSX.Element {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<BackgroundRemover />} />
          <Route path="/photo-editor" element={<PhotoEditor />} />
          <Route path="/qr-generator" element={<QRGenerator />} />
          <Route path="/convert-to-markdown" element={<ConvertToMarkdown />} />
          <Route path="/pdf-toolkit" element={<PDFToolkit />} />
          <Route path="/image-compressor" element={<ImageCompressor />} />
          <Route path="/heic-converter" element={<HeicConverter />} />
          {/* Legacy routes → unified converter */}
          <Route path="/pdf-to-markdown" element={<Navigate to="/convert-to-markdown" replace />} />
          <Route path="/slides-to-markdown" element={<Navigate to="/convert-to-markdown" replace />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
