param([string]$Source,[string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$original=[Drawing.Image]::FromFile($Source)
$frames=@()
try {
  foreach($size in @(16,24,32,48,64,128)){
    $bitmap=[Drawing.Bitmap]::new($size,$size)
    $graphics=[Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($original,0,0,$size,$size)
      $memory=[IO.MemoryStream]::new()
      $pixels=[IO.BinaryWriter]::new($memory)
      try {
        # Explicit 32-bit DIB avoids GDI+'s indexed-colour Icon.Save conversion.
        $maskBytes=[int]([Math]::Ceiling($size/32.0)*4*$size)
        $pixels.Write([uint32]40);$pixels.Write([int32]$size);$pixels.Write([int32]($size*2))
        $pixels.Write([uint16]1);$pixels.Write([uint16]32);$pixels.Write([uint32]0)
        $pixels.Write([uint32]($size*$size*4));1..4 | ForEach-Object {$pixels.Write([uint32]0)}
        for($y=$size-1;$y -ge 0;$y--){for($x=0;$x -lt $size;$x++){
          $pixel=$bitmap.GetPixel($x,$y)
          $pixels.Write([byte]$pixel.B);$pixels.Write([byte]$pixel.G);$pixels.Write([byte]$pixel.R);$pixels.Write([byte]$pixel.A)
        }}
        $pixels.Write([byte[]]::new($maskBytes));$pixels.Flush()
        $frames+=,@{Size=$size;Data=$memory.ToArray()}
      } finally {$pixels.Dispose();$memory.Dispose()}
    } finally {$graphics.Dispose();$bitmap.Dispose()}
  }
} finally {$original.Dispose()}
$writer=[IO.BinaryWriter]::new([IO.File]::Create($Destination))
try {
  $writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$frames.Count)
  $offset=6+16*$frames.Count
  foreach($frame in $frames){
    $writer.Write([byte]$frame.Size);$writer.Write([byte]$frame.Size);$writer.Write([byte]0);$writer.Write([byte]0)
    $writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$frame.Data.Length);$writer.Write([uint32]$offset)
    $offset+=$frame.Data.Length
  }
  foreach($frame in $frames){$writer.Write([byte[]]$frame.Data)}
} finally {$writer.Dispose()}
