from fastapi import APIRouter
from pydantic import BaseModel

from ..deps import CurrentOrg

router = APIRouter(prefix="/orgs", tags=["orgs"])


class OrgOut(BaseModel):
    id: str
    name: str
    slug: str


@router.get("/current", response_model=OrgOut)
def get_current_org(org: CurrentOrg) -> OrgOut:
    return OrgOut(id=org.id, name=org.name, slug=org.slug)
