import { Duplex } from 'node:stream';
import { EventEmitter } from 'node:events';

/**
 * Converts a Cloudflare Workers socket to a Node.js compatible TCP socket
 */
export class CloudflareSocketBridge extends Duplex {
  private cfSocket: any;
  private reader: ReadableStreamDefaultReader | null = null;
  private writer: WritableStreamDefaultWriter | null = null;
  private isConnected = false;
  private isDestroyed = false;
  private hasWriteError = false;
  private writeError: Error | null = null;

  constructor(cfSocket: any) {
    console.log('[SocketBridge] Constructor called with cfSocket:', {
      hasSocket: !!cfSocket,
      socketType: typeof cfSocket,
      socketKeys: cfSocket ? Object.keys(cfSocket) : 'null'
    });
    
    super({
      allowHalfOpen: false,
      readable: true,
      writable: true
    });
    this.cfSocket = cfSocket;
    
    console.log('[SocketBridge] About to call setupSocket()');
    this.setupSocket();
  }

  private async setupSocket() {
    console.log('[SocketBridge] setupSocket() called');
    
    try {
      console.log('[SocketBridge] Checking cfSocket properties:', {
        hasOpened: 'opened' in this.cfSocket,
        hasReadable: 'readable' in this.cfSocket,
        hasWritable: 'writable' in this.cfSocket,
        openedType: typeof this.cfSocket.opened
      });
      
      console.log('[SocketBridge] About to wait for cfSocket.opened');
      // Wait for the socket to be opened
      await this.cfSocket.opened;
      console.log('[SocketBridge] cfSocket.opened resolved successfully');
      
      this.isConnected = true;
      console.log('[SocketBridge] Getting reader and writer...');
      
      this.reader = this.cfSocket.readable.getReader();
      this.writer = this.cfSocket.writable.getWriter();
      
      console.log('[SocketBridge] Reader and writer obtained successfully');

      // Start reading from the Cloudflare socket
      console.log('[SocketBridge] Starting reading process...');
      this.startReading();
      
      // Emit connect event
      console.log('[SocketBridge] Emitting connect event');
      this.emit('connect');
      console.log('[SocketBridge] Setup completed successfully');
    } catch (error) {
      console.error('[SocketBridge] Error in setupSocket():', {
        error: error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : 'No stack trace'
      });
      this.emit('error', error);
    }
  }

  private async startReading() {
    console.log('[SocketBridge] startReading() called', {
      hasReader: !!this.reader,
      isDestroyed: this.isDestroyed,
      isConnected: this.isConnected
    });
    
    if (!this.reader || this.isDestroyed) {
      console.log('[SocketBridge] startReading() early return - no reader or destroyed');
      return;
    }

    try {
      console.log('[SocketBridge] Starting read loop...');
      while (this.isConnected && !this.isDestroyed) {
        const { done, value } = await this.reader.read();
        
        if (done) {
          console.log('[SocketBridge] Read stream done, ending...');
          this.push(null); // Signal end of stream
          break;
        }

        if (value) {
          console.log('[SocketBridge] Received data:', { length: value.length });
          // Convert Uint8Array to Buffer if needed
          const buffer = value instanceof Buffer ? value : Buffer.from(value);
          this.push(buffer);
        }
      }
      console.log('[SocketBridge] Read loop ended');
    } catch (error) {
      console.error('[SocketBridge] Error in startReading():', {
        error: error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        isDestroyed: this.isDestroyed
      });
      if (!this.isDestroyed) {
        this.emit('error', error);
      }
    }
  }

  // Implement Duplex _read method
  _read(size: number) {
    // Reading is handled by startReading(), so this is a no-op
  }

  // Implement Duplex _write method
  _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    console.log('[SocketBridge] _write() called', {
      chunkLength: chunk?.length,
      hasWriter: !!this.writer,
      isDestroyed: this.isDestroyed,
      isConnected: this.isConnected
    });
    
    if (!this.writer || this.isDestroyed) {
      const error = new Error('Socket is not connected or has been destroyed');
      console.error('[SocketBridge] _write() error:', error.message);
      callback(error);
      return;
    }

    // Convert chunk to Uint8Array if needed
    const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    console.log('[SocketBridge] Writing data of length:', data.length);

    this.writer.write(data)
      .then(() => {
        console.log('[SocketBridge] Write successful');
        callback();
      })
      .catch((error) => {
        console.error('[SocketBridge] Write error:', error);
        this.hasWriteError = true;
        this.writeError = error;
        
        // Emit error immediately to notify listeners
        this.emit('error', error);
        
        callback(error);
      });
  }

  // Implement _final method for when the writable side is ending
  _final(callback: (error?: Error | null) => void) {
    if (this.writer && !this.isDestroyed) {
      this.writer.close()
        .then(() => callback())
        .catch((error) => callback(error));
    } else {
      callback();
    }
  }

  // Implement _destroy method
  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    console.log('[SocketBridge] _destroy() called', {
      error: error?.message,
      isDestroyed: this.isDestroyed,
      isConnected: this.isConnected,
      hasReader: !!this.reader,
      hasWriter: !!this.writer
    });
    
    this.isDestroyed = true;
    this.isConnected = false;

    // Close the reader
    if (this.reader) {
      console.log('[SocketBridge] Closing reader...');
      this.reader.cancel().catch((e) => {
        console.error('[SocketBridge] Error closing reader:', e);
      });
      this.reader = null;
    }

    // Close the writer
    if (this.writer) {
      console.log('[SocketBridge] Closing writer...');
      this.writer.close().catch((e) => {
        console.error('[SocketBridge] Error closing writer:', e);
      });
      this.writer = null;
    }

    // Close the Cloudflare socket
    if (this.cfSocket) {
      console.log('[SocketBridge] Closing Cloudflare socket...');
      try {
        this.cfSocket.close();
        console.log('[SocketBridge] Cloudflare socket closed successfully');
      } catch (e) {
        console.error('[SocketBridge] Error closing Cloudflare socket:', e);
      }
    }

    console.log('[SocketBridge] Destroy completed');
    callback(error);
  }

  // Node.js Socket compatibility methods
  get connecting() {
    return !this.isConnected && !this.isDestroyed;
  }

  get readyState() {
    if (this.isDestroyed || this.hasWriteError) return 'closed';
    if (this.isConnected) return 'open';
    return 'opening';
  }
  
  // Method to check if socket has encountered errors
  hasErrors() {
    return this.hasWriteError || this.isDestroyed;
  }
  
  getLastError() {
    return this.writeError;
  }

  // Additional Socket-like methods for compatibility
  setTimeout(timeout: number, callback?: () => void) {
    // Basic timeout implementation
    if (callback) {
      const timer = setTimeout(callback, timeout);
      this.once('close', () => clearTimeout(timer));
    }
    return this;
  }

  setNoDelay(noDelay?: boolean) {
    // No-op for Cloudflare sockets
    return this;
  }

  setKeepAlive(enable?: boolean, initialDelay?: number) {
    // No-op for Cloudflare sockets
    return this;
  }

  address() {
    // Return a basic address object
    return {
      address: '10.0.0.1',
      family: 'IPv4',
      port: 6379
    };
  }

  // Override end method to properly close the socket
  end(chunk?: any, encoding?: BufferEncoding | (() => void), cb?: () => void) {
    if (typeof encoding === 'function') {
      cb = encoding;
      encoding = undefined;
    }

    if (chunk) {
      this.write(chunk, encoding as BufferEncoding);
    }

    return super.end(cb);
  }
}
