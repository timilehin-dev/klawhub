from sqlalchemy import select, or_, String, Column, Integer, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()

class Memory(Base):
    __tablename__ = 'memory'
    id = Column(Integer, primary_key=True)
    content = Column(String)

def escape_wildcards(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

query = "hello world"
words = query.lower().split()

if not words:
    print("No words")
else:
    conditions = [Memory.content.ilike(f"%{escape_wildcards(word)}%", escape="\\") for word in words]
    stmt = select(Memory).where(or_(*conditions)).limit(5)
    print(stmt)
