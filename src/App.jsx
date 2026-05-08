import React from 'react'
import { motion } from 'framer-motion'
import { CloudUpload, Globe } from 'lucide-react'
import UploadCard from './components/UploadCard'

const App = () => {
  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 md:p-10 overflow-hidden bg-[#030712] text-white">
      {/* Background Elements */}
      <div className="fixed inset-0 grid-pattern opacity-100 pointer-events-none" />

      <div className="orb w-[500px] h-[500px] bg-brand top-[-100px] left-[-100px] animate-pulse" />
      <div className="orb w-[400px] h-[400px] bg-brand bottom-[-50px] right-[-50px] animate-float opacity-5" />

      <main className="relative z-10 w-full flex flex-col items-center">
        <motion.header
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12 flex flex-col items-center"
        >
          <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-4 text-white">
            Drop Involve
          </h1>
          <p className="text-slate-400 font-medium text-lg">
            Sikre, raske og pålitelige filoverføringer
          </p>
        </motion.header>

        <UploadCard />

        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-12 flex flex-col items-center gap-2 text-slate-500 text-sm font-medium"
        >
          <p className="text-slate-600 mb-2">Files are encrypted with AES-256 and automatically deleted after 24 hours</p>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 hover:text-brand transition-colors cursor-pointer">
              <Globe size={16} />
              <span>drop.involve.no</span>
            </div>
            <div className="w-1 h-1 bg-slate-700 rounded-full" />
            <span>Terms & Privacy</span>
          </div>
        </motion.footer>
      </main>
    </div>
  )
}

export default App
