"""Create a synthetic text + scanned-page fixture locally in the supplied path."""
import io
import sys
from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

image = Image.new("RGB", (800, 1000), "white")
ImageDraw.Draw(image).text((80, 100), "Synthetic scanned technical drawing", fill="black")
pdf = canvas.Canvas(sys.argv[1], pagesize=(600, 800))
pdf.drawString(50, 700, "Synthetic searchable technical document with enough text for inspection.")
pdf.showPage()
pdf.drawImage(ImageReader(image), 0, 0, width=600, height=800)
pdf.save()
