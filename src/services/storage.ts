import { supabase } from './supabaseClient';

const BUCKET_NAME = 'product-images';

export interface UploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Upload a product image to Supabase Storage
 */
export async function uploadProductImage(file: File, productId?: string): Promise<UploadResult> {
  try {
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return { success: false, error: 'Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.' };
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return { success: false, error: 'File size too large. Maximum size is 5MB.' };
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const fileName = productId 
      ? `${productId}.${fileExt}`
      : `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `products/${fileName}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true // Replace if exists
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return { success: false, error: 'Failed to upload image. Please try again.' };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath);

    return { success: true, url: publicUrl };
  } catch (error) {
    console.error('Upload error:', error);
    return { success: false, error: 'Failed to upload image' };
  }
}

/**
 * Delete a product image from Supabase Storage
 */
export async function deleteProductImage(imageUrl: string): Promise<boolean> {
  try {
    // Extract file path from URL
    const urlParts = imageUrl.split(`${BUCKET_NAME}/`);
    if (urlParts.length < 2) return false;
    
    const filePath = urlParts[1];
    
    // Security: Validate the file path to prevent path traversal attacks
    // Only allow files within the 'products/' directory
    if (!filePath.startsWith('products/') || filePath.includes('..')) {
      console.error('Invalid file path - potential path traversal attempt:', filePath);
      return false;
    }
    
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath]);

    if (error) {
      console.error('Delete error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Delete error:', error);
    return false;
  }
}

/**
 * Compress image before upload (client-side)
 */
export async function compressImage(file: File, maxWidth: number = 800, quality: number = 0.8): Promise<File> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const img = new Image();
    let objectUrl: string | null = null;
    
    const cleanup = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };
    
    img.onload = () => {
      try {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          reject(new Error('Could not get canvas context'));
          return;
        }
        
        // Calculate new dimensions
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // Draw and compress
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(
          (blob) => {
            cleanup();
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now()
              });
              resolve(compressedFile);
            } else {
              reject(new Error('Failed to compress image'));
            }
          },
          'image/jpeg',
          quality
        );
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    
    img.onerror = () => {
      cleanup();
      reject(new Error('Failed to load image'));
    };
    
    objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;
  });
}

/**
 * Create a thumbnail URL from Supabase Storage
 * Uses Supabase's image transformation feature
 */
export function getImageThumbnail(imageUrl: string, width: number = 200, height: number = 200): string {
  if (!imageUrl || !imageUrl.includes('supabase')) {
    return imageUrl;
  }
  
  // Supabase image transformation
  const url = new URL(imageUrl);
  url.searchParams.set('width', width.toString());
  url.searchParams.set('height', height.toString());
  url.searchParams.set('resize', 'cover');
  
  return url.toString();
}
